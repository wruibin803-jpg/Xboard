import {
	App,
	FileSystemAdapter,
	normalizePath,
	Platform,
	TFile,
	TFolder,
} from 'obsidian';
import type { AgentTaskId, AgentTaskInput } from '../agent/types';
import { getAgentTask } from '../agent/taskRegistry';
import type { AgentDashboardSettings } from '../settings';
import type {
	AiDetectedTool,
	AiAttachmentInput,
	AiActivityListener,
	AiConversationSession,
	AiConversationTurnResult,
	AiProfile,
	AiProviderTestResult,
	AiPublishInput,
	AiRunResult,
	AiWorkflowPhase,
	AiWorkflowStatus,
} from '../ai/types';
import { CodexJsonStreamParser } from '../ai/CodexJsonStreamParser';
import { AgentRunner } from './AgentRunner';
import { AiToolResolver } from './AiToolResolver';

interface PreparedAiAttachment {
	name: string;
	fullPath: string;
	isImage: boolean;
}

const MAX_CONTEXT_CHARACTERS = 120_000;
const MAX_CONTEXT_FILES = 40;

export class AiService {
	private readonly runner: AgentRunner;
	private readonly toolResolver: AiToolResolver;
	private readonly statusListeners = new Set<() => void>();
	private readonly workflowStatuses: AiWorkflowStatus[] = [];

	constructor(
		private readonly app: App,
		private readonly getSettings: () => AgentDashboardSettings,
	) {
		this.runner = new AgentRunner(app);
		this.toolResolver = new AiToolResolver();
	}

	async testProvider(profileId?: string): Promise<AiProviderTestResult> {
		this.requireDesktop();
		if (this.runner.isRunning) throw new Error('已有一个 AI 任务正在运行，请稍后再测试。');
		const profile = this.getProfile(profileId);
		const launch = await this.toolResolver.getConfiguredTool(profile);
		const output = await this.runner.run({
			executable: launch.executable,
			args: [...launch.prefixArguments, '--version'],
			cwd: this.getVaultRootPath(),
			timeoutMs: 10_000,
		});
		return {
			output: (output.stdout || output.stderr).trim() || '程序可以启动。',
			tool: launch.tool,
		};
	}

	detectTools(force = false): Promise<AiDetectedTool[]> {
		return this.toolResolver.detectTools(force);
	}

	getWorkflowStatuses(): readonly AiWorkflowStatus[] {
		return this.workflowStatuses;
	}

	onWorkflowStatusChange(listener: () => void): () => void {
		this.statusListeners.add(listener);
		return () => this.statusListeners.delete(listener);
	}

	async startConversation(): Promise<AiConversationSession> {
		this.requireDesktop();
		if (!this.getSettings().aiEnabled) throw new Error('请先在设置中开启“允许运行 AI 工具”。');
		return { workspacePath: await this.runner.createTemporaryWorkspace() };
	}

	async runConversationTurn(
		session: AiConversationSession,
		input: AgentTaskInput,
		profileId: string,
		attachments: AiAttachmentInput[] = [],
		onActivity?: AiActivityListener,
	): Promise<AiConversationTurnResult> {
		this.requireDesktop();
		const settings = this.getSettings();
		if (!settings.aiEnabled) throw new Error('请先在设置中开启“允许运行 AI 工具”。');
		if (this.runner.isRunning) throw new Error('已有一个 AI 任务正在运行，请等待完成或先取消。');
		const profile = this.getProfile(profileId);
		this.requireAttachmentSupport(profile, attachments);
		const task = getAgentTask('my-ai-chat');
		const startedAt = Date.now();
		const workflowId = this.beginWorkflow('AI 临时对话', profile);
		try {
			this.emitActivity(onActivity, 'preparing', '正在准备只读参考材料');
			const context = await this.buildReadContext(profile);
			if (attachments.length > 0) {
				this.emitActivity(onActivity, 'preparing', `正在准备 ${attachments.length} 个附件`);
			}
			const prepared = await this.prepareTemporaryAttachments(session.workspacePath, attachments);
			const prompt = this.addConversationRules(
				this.addReadContext(task.buildPrompt(input, settings), context, prepared),
				session.workspacePath,
			);
			this.setWorkflowPhase(workflowId, 'running', '正在调用模型');
			this.emitActivity(onActivity, 'preparing', `正在启动“${profile.name}”任务模板`);
			const launch = await this.toolResolver.getConfiguredTool(profile);
			const providerArguments = profile.tool === 'codex'
				? this.codexArguments(prompt, profile, prepared.filter((item) => item.isImage).map((item) => item.fullPath))
				: this.customArguments(prompt, session.workspacePath, profile);
			const parser = profile.tool === 'codex' ? new CodexJsonStreamParser() : null;
			let outputBytes = 0;
			const result = await this.runner.run({
				executable: launch.executable,
				args: [...launch.prefixArguments, ...providerArguments],
				cwd: session.workspacePath,
				timeoutMs: profile.timeoutMinutes * 60_000,
				onOutput: (chunk) => {
					if (parser) {
						parser.push(chunk, onActivity);
						return;
					}
					outputBytes += new TextEncoder().encode(chunk).byteLength;
					this.emitActivity(
						onActivity,
						'output',
						'正在接收模型输出',
						`已收到 ${this.formatOutputSize(outputBytes)}`,
					);
				},
				onErrorOutput: (chunk) => this.emitErrorOutput(onActivity, chunk),
			});
			const content = parser ? parser.finish(onActivity) : result.stdout.trim();
			if (!content) throw new Error(result.stderr.trim() || 'AI 工具没有返回内容。');
			this.setWorkflowPhase(workflowId, 'completed', '本轮回复完成');
			this.emitActivity(onActivity, 'completed', '本轮回答已完成');
			return { content, durationMs: Date.now() - startedAt, workflowId };
		} catch (error) {
			const reported = this.presentAttachmentError(error, attachments, profile);
			this.setWorkflowPhase(workflowId, this.isCancelledError(reported) ? 'cancelled' : 'failed',
				reported.message);
			throw reported;
		}
	}

	summarizeConversation(
		input: AgentTaskInput,
		profileId: string,
		attachments: AiAttachmentInput[] = [],
		onActivity?: AiActivityListener,
	): Promise<AiRunResult> {
		return this.runAgentTask('conversation-summary', input, profileId, attachments, onActivity);
	}

	async discardConversation(session: AiConversationSession): Promise<void> {
		await this.runner.discardTemporaryWorkspace(session.workspacePath);
	}

	async runAgentTask(
		taskId: AgentTaskId,
		input: AgentTaskInput,
		profileId?: string,
		attachments: AiAttachmentInput[] = [],
		onActivity?: AiActivityListener,
	): Promise<AiRunResult> {
		this.requireDesktop();
		const settings = this.getSettings();
		if (!settings.aiEnabled) throw new Error('请先在设置中开启“允许运行 AI 工具”。');
		if (this.runner.isRunning) throw new Error('已有一个 AI 任务正在运行，请等待完成或先取消。');
		const profile = this.getProfile(profileId ?? settings.aiDefaultResearchProfileId);
		this.requireAttachmentSupport(profile, attachments);
		const task = getAgentTask(taskId);
		const runStarted = Date.now();
		const workflowId = this.beginWorkflow(task.name, profile);
		try {
			this.emitActivity(onActivity, 'preparing', '正在建立本次 AI 工作区');
			const runFolder = await this.createRunFolder(task.buildTitle(input));
			const workingDirectory = this.getFullPath(runFolder);
			this.emitActivity(onActivity, 'preparing', '正在准备只读参考材料');
			const context = await this.buildReadContext(profile);
			if (attachments.length > 0) {
				this.emitActivity(onActivity, 'preparing', `正在准备 ${attachments.length} 个附件`);
			}
			const prepared = await this.prepareRunAttachments(runFolder, attachments);
			const taskPrompt = this.addReadContext(task.buildPrompt(input, settings), context, prepared);
			const prompt = this.addWorkspaceRules(taskPrompt, runFolder);
			this.setWorkflowPhase(workflowId, 'running', '正在调用模型');
			this.emitActivity(onActivity, 'preparing', `正在启动“${profile.name}”任务模板`);
			const launch = await this.toolResolver.getConfiguredTool(profile);
			const providerArguments = profile.tool === 'codex'
				? this.codexArguments(prompt, profile, prepared.filter((item) => item.isImage).map((item) => item.fullPath))
				: this.customArguments(prompt, workingDirectory, profile);
			const parser = profile.tool === 'codex' ? new CodexJsonStreamParser() : null;
			let outputBytes = 0;
			const result = await this.runner.run({
				executable: launch.executable,
				args: [...launch.prefixArguments, ...providerArguments],
				cwd: workingDirectory,
				timeoutMs: profile.timeoutMinutes * 60_000,
				onOutput: (chunk) => {
					if (parser) {
						parser.push(chunk, onActivity);
						return;
					}
					outputBytes += new TextEncoder().encode(chunk).byteLength;
					this.emitActivity(
						onActivity,
						'output',
						'正在接收模型输出',
						`已收到 ${this.formatOutputSize(outputBytes)}`,
					);
				},
				onErrorOutput: (chunk) => this.emitErrorOutput(onActivity, chunk),
			});
			const content = parser ? parser.finish(onActivity) : result.stdout.trim();
			if (!content) throw new Error(result.stderr.trim() || 'AI 工具没有返回内容。');
			this.emitActivity(onActivity, 'output', '正在保存 AI 结果');
			const path = this.findAvailablePath(runFolder, '结果');
			const file = await this.app.vault.create(path, `${content}\n`);
			this.setWorkflowPhase(workflowId, 'waiting-confirmation', '结果已生成，等待确认保存');
			this.emitActivity(onActivity, 'completed', '结果已生成，等待你确认');
			return { file, content, durationMs: Date.now() - runStarted, workflowId };
		} catch (error) {
			const reported = this.presentAttachmentError(error, attachments, profile);
			this.setWorkflowPhase(workflowId, this.isCancelledError(reported) ? 'cancelled' : 'failed',
				reported.message);
			throw reported;
		}
	}

	updateWorkflowStatus(id: string, phase: AiWorkflowPhase, message: string): void {
		this.setWorkflowPhase(id, phase, message);
	}

	cancelActiveRun(): void {
		this.runner.cancel();
	}

	async publishResult(input: AiPublishInput): Promise<TFile> {
		const destination = this.requireFormalFolder(input.destinationFolder);
		const sourceContent = await this.app.vault.read(input.source);
		const baseName = this.sanitizeFileName(input.fileName) || input.source.basename;
		const path = this.findAvailablePath(destination, baseName);
		return this.app.vault.create(path, sourceContent);
	}

	private codexArguments(prompt: string, profile: AiProfile, imagePaths: string[]): string[] {
		const args: string[] = [];
		if (profile.networkAccess) args.push('--search');
		if (profile.permissionMode === 'full-access') {
			args.push('--dangerously-bypass-approvals-and-sandbox');
		} else {
			args.push('--sandbox', 'workspace-write', '--ask-for-approval', 'never');
		}
		if (profile.model) args.push('--model', profile.model);
		args.push('-c', `model_reasoning_effort="${profile.reasoningEffort}"`);
		args.push('exec');
		for (const imagePath of imagePaths) args.push('--image', imagePath);
		args.push('--json', '--ephemeral', '--skip-git-repo-check', '--color', 'never');
		args.push(prompt);
		return args;
	}

	private customArguments(prompt: string, workingDirectory: string, profile: AiProfile): string[] {
		return profile.customArguments
			.split(/\r?\n/)
			.map((argument) => argument.trim())
			.filter(Boolean)
			.map((argument) => argument
				.replaceAll('{{prompt}}', prompt)
				.replaceAll('{{workdir}}', workingDirectory)
				.replaceAll('{{model}}', profile.model)
				.replaceAll('{{reasoning}}', profile.reasoningEffort)
				.replaceAll('{{network}}', String(profile.networkAccess)));
	}

	private addWorkspaceRules(prompt: string, runFolder: string): string {
		return [
			prompt.trim(),
			'',
			`当前可写工作目录：${runFolder}`,
			'如果需要生成图片或附件，请放在当前工作目录，并在 Markdown 中使用相对路径引用。',
			'不得修改当前工作目录之外的文件。',
		].join('\n');
	}

	private addConversationRules(prompt: string, workspacePath: string): string {
		return [
			prompt.trim(),
			'',
			`本次对话使用临时工作目录：${workspacePath}`,
			'只能读取提示中“本次附件”列出的文件；不得读取临时目录中的其他文件，也不得访问用户的正式知识库。',
			'不得创建、修改或删除文件。',
			'只通过标准输出返回本轮答复。',
		].join('\n');
	}

	private getProfile(profileId?: string): AiProfile {
		const settings = this.getSettings();
		const profile = settings.aiProfiles.find((candidate) => candidate.id === profileId)
			?? settings.aiProfiles.find((candidate) => candidate.id === settings.aiDefaultChatProfileId)
			?? settings.aiProfiles[0];
		if (!profile) throw new Error('请先在设置中添加一个 AI 工作流任务模板。');
		return profile;
	}

	private requireAttachmentSupport(profile: AiProfile, attachments: AiAttachmentInput[]): void {
		if (attachments.length === 0) return;
		if (profile.attachmentSupport === 'unsupported') {
			throw new Error(`AI 工作流任务模板“${profile.name}”标记为不支持文档和图片，请换一个任务模板。`);
		}
		if (attachments.length > 10) throw new Error('一次最多添加 10 个文档或图片。');
		const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.data.byteLength, 0);
		if (totalBytes > 60 * 1024 * 1024) throw new Error('附件总大小不能超过 60 MB。');
	}

	private async buildReadContext(profile: AiProfile): Promise<string> {
		if (profile.readScope === 'none') return '';
		let files: TFile[] = [];
		if (profile.readScope === 'active-note') {
			const active = this.app.workspace.getActiveFile();
			if (active?.extension === 'md') files = [active];
		} else if (profile.readScope === 'today') {
			const now = new Date();
			files = this.app.vault.getMarkdownFiles()
				.filter((file) => {
					const modified = new Date(file.stat.mtime);
					return modified.getFullYear() === now.getFullYear()
						&& modified.getMonth() === now.getMonth()
						&& modified.getDate() === now.getDate();
				})
				.sort((first, second) => second.stat.mtime - first.stat.mtime);
		} else {
			const folder = normalizePath(profile.readFolder);
			files = this.app.vault.getMarkdownFiles()
				.filter((file) => file.path === folder || file.path.startsWith(`${folder}/`))
				.sort((first, second) => second.stat.mtime - first.stat.mtime);
		}
		files = files.slice(0, MAX_CONTEXT_FILES);
		if (files.length === 0) return '没有找到本方案允许读取的 Markdown 笔记。';
		const sections: string[] = [];
		let used = 0;
		for (const file of files) {
			if (used >= MAX_CONTEXT_CHARACTERS) break;
			const content = await this.app.vault.cachedRead(file);
			const remaining = MAX_CONTEXT_CHARACTERS - used;
			const excerpt = content.slice(0, Math.min(remaining, 16_000));
			sections.push(`### ${file.path}\n${excerpt}`);
			used += excerpt.length;
		}
		return sections.join('\n\n');
	}

	private addReadContext(
		prompt: string,
		context: string,
		attachments: PreparedAiAttachment[],
	): string {
		const sections = [prompt.trim()];
		if (context) {
			sections.push(
				'## Xboard 提供的只读参考材料',
				'这些内容只用于回答，不代表用户要求修改原笔记。',
				context,
			);
		}
		if (attachments.length > 0) {
			sections.push(
				'## 本次附件',
				...attachments.map((attachment) => `- ${attachment.name}`),
				'请根据任务需要读取这些附件。不要修改原附件。',
			);
		}
		return sections.join('\n\n');
	}

	private async prepareTemporaryAttachments(
		workspacePath: string,
		attachments: AiAttachmentInput[],
	): Promise<PreparedAiAttachment[]> {
		const prepared: PreparedAiAttachment[] = [];
		const used = new Set<string>();
		for (const attachment of attachments) {
			const name = this.uniqueAttachmentName(attachment.name, used);
			const fullPath = await this.runner.writeTemporaryAttachment(workspacePath, name, attachment.data);
			prepared.push({ name, fullPath, isImage: this.isImageAttachment(attachment) });
		}
		return prepared;
	}

	private async prepareRunAttachments(
		runFolder: string,
		attachments: AiAttachmentInput[],
	): Promise<PreparedAiAttachment[]> {
		const prepared: PreparedAiAttachment[] = [];
		const used = new Set<string>();
		for (const attachment of attachments) {
			const name = this.uniqueAttachmentName(attachment.name, used);
			const path = normalizePath(`${runFolder}/${name}`);
			await this.app.vault.createBinary(path, attachment.data);
			prepared.push({
				name,
				fullPath: this.getFullPath(path),
				isImage: this.isImageAttachment(attachment),
			});
		}
		return prepared;
	}

	private uniqueAttachmentName(value: string, used: Set<string>): string {
		const source = value.replaceAll('\\', '/').split('/').pop() ?? '附件';
		const safe = this.sanitizeFileName(source) || '附件';
		const dot = safe.lastIndexOf('.');
		const base = dot > 0 ? safe.slice(0, dot) : safe;
		const extension = dot > 0 ? safe.slice(dot) : '';
		let name = `${base}${extension}`;
		let index = 1;
		while (used.has(name.toLocaleLowerCase())) {
			index += 1;
			name = `${base}-${index}${extension}`;
		}
		used.add(name.toLocaleLowerCase());
		return name;
	}

	private isImageAttachment(attachment: AiAttachmentInput): boolean {
		return attachment.type.startsWith('image/')
			|| /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(attachment.name);
	}

	private beginWorkflow(taskName: string, profile: AiProfile): string {
		const now = Date.now();
		const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
		this.workflowStatuses.unshift({
			id,
			taskName,
			profileName: profile.name,
			phase: 'preparing',
			message: '正在准备材料',
			startedAt: now,
			updatedAt: now,
		});
		this.workflowStatuses.splice(8);
		this.emitWorkflowStatus();
		return id;
	}

	private setWorkflowPhase(id: string, phase: AiWorkflowPhase, message: string): void {
		const status = this.workflowStatuses.find((candidate) => candidate.id === id);
		if (!status) return;
		status.phase = phase;
		status.message = message;
		status.updatedAt = Date.now();
		this.emitWorkflowStatus();
	}

	private emitWorkflowStatus(): void {
		for (const listener of this.statusListeners) listener();
	}

	private isCancelledError(error: unknown): boolean {
		return error instanceof Error && error.message.includes('已取消');
	}

	private presentAttachmentError(
		error: unknown,
		attachments: AiAttachmentInput[],
		profile: AiProfile,
	): Error {
		const reported = error instanceof Error ? error : new Error('AI 工作流失败。');
		if (attachments.length === 0 || profile.attachmentSupport === 'unsupported') return reported;
		if (!/(image|vision|multimodal|attachment|unsupported|not support|图片|附件|多模态)/i.test(reported.message)) {
			return reported;
		}
		return new Error(
			`当前工具或模型可能不支持这次的文档或图片输入。请换用支持多模态的模型，或在 AI 工作流任务模板中检查“文档和图片”设置。\n\n原始错误：${reported.message}`,
		);
	}

	private emitActivity(
		listener: AiActivityListener | undefined,
		kind: Parameters<AiActivityListener>[0]['kind'],
		label: string,
		detail?: string,
	): void {
		listener?.({
			kind,
			label,
			...(detail ? { detail } : {}),
			timestamp: Date.now(),
		});
	}

	private emitErrorOutput(listener: AiActivityListener | undefined, chunk: string): void {
		const detail = chunk
			.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g'), '')
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.pop()
			?.replace(/\s+/g, ' ')
			.slice(0, 240);
		if (detail) this.emitActivity(listener, 'warning', '命令行工具报告运行信息', detail);
	}

	private formatOutputSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}

	private async createRunFolder(title: string): Promise<string> {
		const root = this.requireDataFolder(this.getSettings().xboardDataFolder);
		const now = new Date();
		const timestamp = [
			now.getFullYear(),
			String(now.getMonth() + 1).padStart(2, '0'),
			String(now.getDate()).padStart(2, '0'),
			'-',
			String(now.getHours()).padStart(2, '0'),
			String(now.getMinutes()).padStart(2, '0'),
			String(now.getSeconds()).padStart(2, '0'),
		].join('');
		const folder = normalizePath(`${root}/AI 运行/${timestamp} ${this.sanitizeFileName(title) || 'AI 任务'}`);
		await this.ensureFolder(folder);
		return folder;
	}

	private async ensureFolder(path: string): Promise<void> {
		let current = '';
		for (const segment of path.split('/').filter(Boolean)) {
			current = current ? `${current}/${segment}` : segment;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) {
				await this.app.vault.createFolder(current);
				continue;
			}
			if (!(existing instanceof TFolder)) throw new Error(`“${current}”不是文件夹。`);
		}
	}

	private getFullPath(vaultPath: string): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) throw new Error('当前知识库不支持运行本地 AI 命令。');
		return adapter.getFullPath(vaultPath);
	}

	private getVaultRootPath(): string {
		return this.getFullPath('');
	}

	private requireDataFolder(value: string): string {
		const path = normalizePath(value.trim());
		if (!path || path === '/' || path.split('/').some((segment) => segment === '.' || segment === '..')) {
			throw new Error('Xboard 数据目录无效。');
		}
		if (path === this.app.vault.configDir || path.startsWith(`${this.app.vault.configDir}/`)) {
			throw new Error('Xboard 数据目录不能位于 Obsidian 配置目录中。');
		}
		return path;
	}

	private requireFormalFolder(value: string): string {
		const path = normalizePath(value.trim());
		if (!path || path === '/') throw new Error('请选择正式知识库中的保存目录。');
		const dataFolder = this.requireDataFolder(this.getSettings().xboardDataFolder);
		if (path === dataFolder || path.startsWith(`${dataFolder}/`)) {
			throw new Error('请选择 Xboard 数据目录以外的正式保存目录。');
		}
		if (path === this.app.vault.configDir || path.startsWith(`${this.app.vault.configDir}/`)) {
			throw new Error('正式结果不能保存到 Obsidian 配置目录。');
		}
		const folder = this.app.vault.getAbstractFileByPath(path);
		if (!(folder instanceof TFolder)) throw new Error(`正式保存目录“${path}”不存在。`);
		return path;
	}

	private findAvailablePath(folder: string, baseName: string): string {
		const safeName = this.sanitizeFileName(baseName) || 'AI 结果';
		let index = 1;
		let path = normalizePath(`${folder}/${safeName}.md`);
		while (this.app.vault.getAbstractFileByPath(path)) {
			index += 1;
			path = normalizePath(`${folder}/${safeName}-${index}.md`);
		}
		return path;
	}

	private sanitizeFileName(value: string): string {
		const forbidden = new Set('\\/:*?"<>|#^[]');
		return [...value.trim()]
			.map((character) => forbidden.has(character) ? '-' : character)
			.join('')
			.replace(/\s+/g, ' ')
			.replace(/-+/g, '-')
			.replace(/[. ]+$/g, '')
			.slice(0, 80);
	}

	private requireDesktop(): void {
		if (!Platform.isDesktop) throw new Error('本地 AI 工具只能在桌面版 Obsidian 中运行。');
	}
}
