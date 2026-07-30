import { App, Platform } from 'obsidian';
import type { AgentProcessInput, AgentProcessResult } from '../agent/types';

declare const require: (id: string) => unknown;

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_BYTES = 256 * 1024;

interface KillableProcess {
	kill(): boolean;
}

export class AgentRunner {
	private activeProcess: KillableProcess | null = null;

	constructor(private readonly app: App) {}

	get isRunning(): boolean {
		return this.activeProcess !== null;
	}

	async run(input: AgentProcessInput): Promise<AgentProcessResult> {
		this.requireDesktop();
		if (this.activeProcess) throw new Error('已有一个 AI 任务正在运行，请等待完成或先取消。');
		const childProcess = this.loadChildProcess();
		return new Promise((resolve, reject) => {
			const child = childProcess.spawn(input.executable, input.args, {
				cwd: input.cwd,
				shell: false,
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			this.activeProcess = child;
			let stdout = '';
			let stderr = '';
			let settled = false;
			const viewWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
			const timeout = viewWindow?.setTimeout(() => {
				child.kill();
				finish(new Error('AI 任务运行超时，已停止。'));
			}, input.timeoutMs);
			const finish = (error?: Error): void => {
				if (settled) return;
				settled = true;
				if (timeout !== undefined) viewWindow?.clearTimeout(timeout);
				this.activeProcess = null;
				if (error) reject(error);
				else resolve({ stdout, stderr });
			};
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', (chunk: string) => {
				stdout += chunk;
				input.onOutput?.(chunk);
				if (new TextEncoder().encode(stdout).byteLength > MAX_OUTPUT_BYTES) {
					child.kill();
					finish(new Error('AI 返回内容超过 4 MB，已停止任务。'));
				}
			});
			child.stderr.on('data', (chunk: string) => {
				if (new TextEncoder().encode(stderr).byteLength < MAX_ERROR_BYTES) stderr += chunk;
				input.onErrorOutput?.(chunk);
			});
			child.on('error', (error) => finish(new Error(`无法启动 AI 工具：${error.message}`)));
			child.on('close', (code, signal) => {
				if (settled) return;
				if (signal) {
					finish(new Error('AI 任务已取消。'));
					return;
				}
				if (code !== 0) {
					finish(new Error(stderr.trim() || `AI 工具退出，代码为 ${code ?? '未知'}。`));
					return;
				}
				finish();
			});
		});
	}

	cancel(): void {
		this.activeProcess?.kill();
	}

	async createTemporaryWorkspace(): Promise<string> {
		this.requireDesktop();
		const node = this.loadWorkspaceModules();
		return node.fileSystem.mkdtemp(node.path.join(node.operatingSystem.tmpdir(), 'xboard-chat-'));
	}

	async discardTemporaryWorkspace(workspacePath: string): Promise<void> {
		this.requireDesktop();
		const node = this.loadWorkspaceModules();
		const root = node.path.resolve(node.operatingSystem.tmpdir());
		const target = node.path.resolve(workspacePath);
		if (node.path.dirname(target) !== root || !node.path.basename(target).startsWith('xboard-chat-')) {
			throw new Error('临时对话目录无效，已停止清理。');
		}
		await node.fileSystem.rm(target, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 120,
		});
	}

	async writeTemporaryAttachment(
		workspacePath: string,
		fileName: string,
		data: ArrayBuffer,
	): Promise<string> {
		this.requireDesktop();
		const node = this.loadWorkspaceModules();
		const workspace = node.path.resolve(workspacePath);
		const root = node.path.resolve(node.operatingSystem.tmpdir());
		if (node.path.dirname(workspace) !== root || !node.path.basename(workspace).startsWith('xboard-chat-')) {
			throw new Error('临时对话目录无效，无法添加附件。');
		}
		const target = node.path.resolve(workspace, fileName);
		if (node.path.dirname(target) !== workspace) throw new Error('附件名称无效。');
		await node.fileSystem.writeFile(target, new Uint8Array(data));
		return target;
	}

	private loadChildProcess(): typeof import('node:child_process') {
		// Obsidian executes desktop plugins through CommonJS and cannot dynamically import Node built-ins.
		if (Platform.isDesktop) return require('node:child_process') as typeof import('node:child_process');
		throw new Error('本地 AI 工具只能在桌面版 Obsidian 中运行。');
	}

	private loadWorkspaceModules() {
		if (Platform.isDesktop) {
			return {
				fileSystem: require('node:fs/promises') as typeof import('node:fs/promises'),
				operatingSystem: require('node:os') as typeof import('node:os'),
				path: require('node:path') as typeof import('node:path'),
			};
		}
		throw new Error('本地 AI 工具只能在桌面版 Obsidian 中运行。');
	}

	private requireDesktop(): void {
		if (!Platform.isDesktop) throw new Error('本地 AI 工具只能在桌面版 Obsidian 中运行。');
	}
}
