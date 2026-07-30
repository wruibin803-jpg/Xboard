import { App, Modal, Notice, Platform, setIcon } from 'obsidian';
import type {
	AiAttachmentInput,
	AiConversationSession,
	AiProfile,
	AiRunResult,
	AiTaskProposal,
	AiTaskProposalItem,
} from '../ai/types';
import { AiActivityView } from '../components/AiActivityView';
import { AiService } from '../services/AiService';

interface MyAiModalOptions {
	service: AiService;
	profiles: AiProfile[];
	defaultProfileId: string;
	onSummary: (result: AiRunResult, suggestedFileName: string) => void;
	onTaskProposal: (
		tasks: AiTaskProposalItem[],
		workflowId: string,
		onStatus: (phase: 'saving' | 'completed' | 'failed' | 'cancelled', message: string) => void,
	) => void;
}

interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

const ATTACHMENT_ACCEPT = [
	'image/*',
	'.pdf',
	'.doc',
	'.docx',
	'.txt',
	'.md',
	'.csv',
	'.ppt',
	'.pptx',
	'.xls',
	'.xlsx',
].join(',');

export class MyAiModal extends Modal {
	private readonly messages: ChatMessage[] = [];
	private session: AiConversationSession | null = null;
	private messageListEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private profileEl!: HTMLSelectElement;
	private attachmentInputEl!: HTMLInputElement;
	private attachmentListEl!: HTMLElement;
	private activityView!: AiActivityView;
	private sendEl!: HTMLButtonElement;
	private summaryEl!: HTMLButtonElement;
	private endEl!: HTMLButtonElement;
	private cancelEl!: HTMLButtonElement;
	private statusEl!: HTMLElement;
	private running = false;
	private selectedProfileId: string;
	private attachments: File[] = [];
	private domCleanups: Array<() => void> = [];

	constructor(app: App, private readonly options: MyAiModalOptions) {
		super(app);
		this.selectedProfileId = options.profiles.some((profile) => profile.id === options.defaultProfileId)
			? options.defaultProfileId
			: options.profiles[0]?.id ?? '';
	}

	onOpen(): void {
		this.setTitle('AI 临时对话');
		this.modalEl.addClass('agent-dashboard-ai-chat-modal', 'agent-dashboard-my-ai-modal');
		if (!Platform.isDesktop) {
			this.contentEl.createEl('p', { text: '本地 AI 工具只能在桌面版 Obsidian 中运行。' });
			return;
		}
		this.contentEl.createEl('p', {
			cls: 'agent-dashboard-ai-chat-intro',
			text: '对话和附件只放在本次临时空间。只有点击“一键总结”才会生成可保存的 Markdown。',
		});
		this.renderSessionControls();
		this.activityView = new AiActivityView(this.contentEl);
		this.messageListEl = this.contentEl.createDiv({
			cls: 'agent-dashboard-ai-chat-messages',
			attr: { role: 'log', 'aria-live': 'polite', 'aria-label': 'AI 临时对话' },
		});
		this.messageListEl.createEl('p', {
			cls: 'agent-dashboard-ai-chat-empty',
			text: '可以直接提问，粘贴老师发来的文字并让 AI 提取待办，或添加文档和图片。',
		});
		const composer = this.contentEl.createDiv({ cls: 'agent-dashboard-ai-composer' });
		this.inputEl = composer.createEl('textarea', {
			attr: {
				placeholder: '输入消息；Enter 发送，Shift + Enter 换行',
				'aria-label': '对话内容',
				rows: '4',
			},
		});
		const actions = composer.createDiv({ cls: 'agent-dashboard-ai-composer-actions' });
		this.statusEl = actions.createSpan({
			cls: 'agent-dashboard-ai-chat-status',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		this.cancelEl = actions.createEl('button', {
			cls: 'agent-dashboard-ai-cancel',
			text: '停止',
			attr: { type: 'button' },
		});
		this.summaryEl = actions.createEl('button', {
			cls: 'agent-dashboard-ai-summary',
			text: '一键总结',
			attr: { type: 'button' },
		});
		this.endEl = actions.createEl('button', {
			cls: 'agent-dashboard-ai-end',
			text: '结束对话',
			attr: { type: 'button' },
		});
		this.sendEl = actions.createEl('button', {
			cls: 'mod-cta agent-dashboard-ai-send',
			attr: { type: 'button', 'aria-label': '发送消息' },
		});
		const icon = this.sendEl.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(icon, 'send');
		this.sendEl.createSpan({ text: '发送' });

		this.registerDomEvent(this.sendEl, 'click', () => void this.sendMessage());
		this.registerDomEvent(this.summaryEl, 'click', () => void this.summarizeConversation());
		this.registerDomEvent(this.endEl, 'click', () => this.close());
		this.registerDomEvent(this.cancelEl, 'click', () => {
			this.options.service.cancelActiveRun();
			this.statusEl.setText('正在停止…');
		});
		this.registerDomEvent(this.inputEl, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				void this.sendMessage();
			}
		});
		this.updateRunningState();
		this.inputEl.focus();
	}

	onClose(): void {
		if (this.running) this.options.service.cancelActiveRun();
		this.activityView?.destroy();
		const session = this.session;
		this.session = null;
		if (session) void this.options.service.discardConversation(session).catch(() => undefined);
		this.cleanupDomEvents();
		this.contentEl.empty();
	}

	private registerDomEvent<K extends keyof HTMLElementEventMap>(
		element: HTMLElement,
		type: K,
		handler: (event: HTMLElementEventMap[K]) => void,
	): void {
		element.addEventListener(type, handler);
		this.domCleanups.push(() => element.removeEventListener(type, handler));
	}

	private cleanupDomEvents(): void {
		for (const cleanup of this.domCleanups.splice(0)) cleanup();
	}

	private renderSessionControls(): void {
		const controls = this.contentEl.createDiv({ cls: 'agent-dashboard-ai-session-controls' });
		const profileField = controls.createDiv({ cls: 'agent-dashboard-ai-control-field' });
		profileField.createEl('label', { text: '任务模板' });
		this.profileEl = profileField.createEl('select', { attr: { 'aria-label': '选择 AI 工作流任务模板' } });
		for (const profile of this.options.profiles) {
			this.profileEl.createEl('option', {
				text: profile.name,
				attr: { value: profile.id },
			});
		}
		this.profileEl.value = this.selectedProfileId;
		this.registerDomEvent(this.profileEl, 'change', () => {
			this.selectedProfileId = this.profileEl.value;
			this.warnAboutAttachmentSupport();
		});

		const attachmentField = controls.createDiv({ cls: 'agent-dashboard-ai-control-field' });
		attachmentField.createEl('label', { text: '参考材料' });
		const attachmentButton = attachmentField.createEl('button', {
			text: '添加文档或图片',
			attr: { type: 'button' },
		});
		this.attachmentInputEl = attachmentField.createEl('input', {
			cls: 'agent-dashboard-visually-hidden',
			attr: {
				type: 'file',
				multiple: 'true',
				accept: ATTACHMENT_ACCEPT,
				'aria-label': '添加文档或图片',
			},
		});
		this.registerDomEvent(attachmentButton, 'click', () => this.attachmentInputEl.click());
		this.registerDomEvent(this.attachmentInputEl, 'change', () => {
			const files = Array.from(this.attachmentInputEl.files ?? []);
			if (files.length === 0) return;
			if (this.currentProfile()?.attachmentSupport === 'unsupported') {
				new Notice('当前任务模板标记为不支持文档和图片，请先切换任务模板。');
				this.attachmentInputEl.value = '';
				return;
			}
			this.attachments = [...this.attachments, ...files].slice(0, 10);
			this.attachmentInputEl.value = '';
			this.renderAttachments();
			this.warnAboutAttachmentSupport();
		});
		this.attachmentListEl = this.contentEl.createDiv({
			cls: 'agent-dashboard-ai-attachments',
			attr: { 'aria-live': 'polite' },
		});
		this.renderAttachments();
	}

	private async sendMessage(): Promise<void> {
		const question = this.inputEl.value.trim();
		if (!question || this.running) {
			if (!question) this.inputEl.focus();
			return;
		}
		this.messageListEl.querySelector('.agent-dashboard-ai-chat-empty')?.remove();
		this.messages.push({ role: 'user', content: question });
		this.renderMessage('user', question);
		this.inputEl.value = '';
		this.running = true;
		this.statusEl.setText('AI 正在回复…');
		this.activityView.start('正在准备本轮对话');
		this.updateRunningState();
		try {
			this.session ??= await this.options.service.startConversation();
			const result = await this.options.service.runConversationTurn(
				this.session,
				{ titleHint: question, content: this.buildConversation() },
				this.selectedProfileId,
				await this.filesToAttachments(),
				(activity) => this.activityView.update(activity),
			);
			this.attachments = [];
			this.renderAttachments();
			const proposal = this.extractTaskProposal(result.content);
			const visibleContent = this.removeTaskProposal(result.content);
			this.messages.push({ role: 'assistant', content: visibleContent });
			this.renderMessage('assistant', visibleContent);
			if (proposal) {
				this.options.service.updateWorkflowStatus(
					result.workflowId,
					'waiting-confirmation',
					'待办已提取，等待你确认',
				);
				this.activityView.finish('waiting-confirmation', '待办已提取，等待你确认');
				this.options.onTaskProposal(
					proposal.tasks,
					result.workflowId,
					(phase, message) => {
						if (phase === 'saving') {
							this.activityView.report('output', message);
							return;
						}
						this.activityView.finish(phase, message);
					},
				);
				this.statusEl.setText(`已提取 ${proposal.tasks.length} 条待办，请确认后添加`);
			} else {
				this.activityView.finish('completed', '本轮回答已完成');
				this.statusEl.setText(`已回复，耗时 ${this.formatDuration(result.durationMs)}`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'AI 对话运行失败。';
			this.activityView.finish(
				message.includes('取消') ? 'cancelled' : 'failed',
				message.includes('取消') ? '任务已取消' : '任务运行失败',
				message,
			);
			this.statusEl.setText(message);
			new Notice(message);
		} finally {
			this.running = false;
			this.updateRunningState();
			this.inputEl.focus();
		}
	}

	private async summarizeConversation(): Promise<void> {
		if (this.running || !this.messages.some((message) => message.role === 'assistant')) return;
		const firstQuestion = this.messages.find((message) => message.role === 'user')?.content ?? '本次对话';
		this.running = true;
		this.statusEl.setText('正在生成对话总结…');
		this.activityView.start('正在准备对话总结');
		this.updateRunningState();
		let result: AiRunResult | null = null;
		try {
			result = await this.options.service.summarizeConversation(
				{ titleHint: firstQuestion, content: this.buildConversation() },
				this.selectedProfileId,
				[],
				(activity) => this.activityView.update(activity),
			);
			this.activityView.finish('waiting-confirmation', '总结已生成，等待你确认保存');
			this.statusEl.setText(`总结完成，耗时 ${this.formatDuration(result.durationMs)}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : '对话总结失败。';
			this.activityView.finish(
				message.includes('取消') ? 'cancelled' : 'failed',
				message.includes('取消') ? '任务已取消' : '总结生成失败',
				message,
			);
			this.statusEl.setText(message);
			new Notice(message);
		} finally {
			this.running = false;
			this.updateRunningState();
		}
		if (!result) return;
		this.close();
		this.options.onSummary(result, `AI 临时对话总结 ${firstQuestion.slice(0, 40)}`);
	}

	private buildConversation(): string {
		return this.messages.map((message) => (
			`${message.role === 'user' ? '用户' : 'AI'}：\n${message.content}`
		)).join('\n\n');
	}

	private renderMessage(role: ChatMessage['role'], content: string): void {
		const message = this.messageListEl.createEl('article', {
			cls: `agent-dashboard-ai-message is-${role}`,
		});
		message.createSpan({
			cls: 'agent-dashboard-ai-message-role',
			text: role === 'user' ? '你' : 'AI',
		});
		message.createEl('pre', { text: content || 'AI 已生成待办建议。' });
		message.scrollIntoView({ block: 'nearest' });
	}

	private renderAttachments(): void {
		if (!this.attachmentListEl) return;
		this.attachmentListEl.empty();
		for (const [index, file] of this.attachments.entries()) {
			const chip = this.attachmentListEl.createDiv({ cls: 'agent-dashboard-ai-attachment' });
			chip.createSpan({ text: file.name });
			const remove = chip.createEl('button', {
				text: '移除',
				attr: { type: 'button', 'aria-label': `移除 ${file.name}` },
			});
			this.registerDomEvent(remove, 'click', () => {
				this.attachments.splice(index, 1);
				this.renderAttachments();
			});
		}
	}

	private updateRunningState(): void {
		this.modalEl.classList.toggle('is-running', this.running);
		if (this.sendEl) this.sendEl.disabled = this.running;
		if (this.inputEl) this.inputEl.disabled = this.running;
		if (this.profileEl) this.profileEl.disabled = this.running;
		if (this.attachmentInputEl) this.attachmentInputEl.disabled = this.running;
		if (this.cancelEl) this.cancelEl.disabled = !this.running;
		if (this.summaryEl) {
			this.summaryEl.disabled = this.running
				|| !this.messages.some((message) => message.role === 'assistant');
		}
	}

	private currentProfile(): AiProfile | undefined {
		return this.options.profiles.find((profile) => profile.id === this.selectedProfileId);
	}

	private warnAboutAttachmentSupport(): void {
		if (this.attachments.length === 0) return;
		const profile = this.currentProfile();
		if (profile?.attachmentSupport === 'auto') {
			new Notice('当前任务模板将由命令行工具和所选模型判断附件能力；若不支持，请换用支持图片或文档的模型。');
		}
	}

	private async filesToAttachments(): Promise<AiAttachmentInput[]> {
		return Promise.all(this.attachments.map(async (file) => ({
			name: file.name,
			type: file.type,
			data: await file.arrayBuffer(),
		})));
	}

	private extractTaskProposal(content: string): AiTaskProposal | null {
		const match = content.match(/<XBOARD_TASK_PROPOSAL>([\s\S]*?)<\/XBOARD_TASK_PROPOSAL>/);
		if (!match?.[1]) return null;
		try {
			const parsed = JSON.parse(match[1]) as Partial<AiTaskProposal>;
			if (parsed.type !== 'create_tasks' || !Array.isArray(parsed.tasks)) return null;
			const tasks = parsed.tasks
				.slice(0, 20)
				.filter((task): task is AiTaskProposalItem => (
					typeof task === 'object'
					&& task !== null
					&& typeof task.title === 'string'
					&& typeof task.note === 'string'
					&& typeof task.dueDate === 'string'
					&& (task.kind === 'todo' || task.kind === 'ddl')
					&& (task.recurrence === 'none' || task.recurrence === 'daily' || task.recurrence === 'weekly')
					&& (task.priority === 'high' || task.priority === 'medium' || task.priority === 'low')
					&& typeof task.needsClarification === 'boolean'
				));
			return tasks.length > 0 ? { type: 'create_tasks', tasks } : null;
		} catch {
			return null;
		}
	}

	private removeTaskProposal(content: string): string {
		return content
			.replace(/<XBOARD_TASK_PROPOSAL>[\s\S]*?<\/XBOARD_TASK_PROPOSAL>/g, '')
			.trim();
	}

	private formatDuration(durationMs: number): string {
		const seconds = Math.max(1, Math.round(durationMs / 1000));
		return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
	}
}
