import { App, Modal, Notice, Platform, setIcon } from 'obsidian';
import type {
	AiAttachmentInput,
	AiProfile,
	AiRunResult,
} from '../ai/types';
import { AiActivityView } from '../components/AiActivityView';
import { AiService } from '../services/AiService';

interface DeepResearchModalOptions {
	service: AiService;
	profiles: AiProfile[];
	defaultProfileId: string;
	onResult: (
		result: AiRunResult,
		suggestedFileName: string,
		onDecision: (decision: 'published' | 'kept') => void,
	) => void;
}

const ATTACHMENT_ACCEPT = 'image/*,.pdf,.doc,.docx,.txt,.md,.csv,.ppt,.pptx,.xls,.xlsx';

export class DeepResearchModal extends Modal {
	private inputEl!: HTMLTextAreaElement;
	private profileEl!: HTMLSelectElement;
	private attachmentInputEl!: HTMLInputElement;
	private attachmentListEl!: HTMLElement;
	private activityView!: AiActivityView;
	private sendEl!: HTMLButtonElement;
	private cancelEl!: HTMLButtonElement;
	private statusEl!: HTMLElement;
	private running = false;
	private selectedProfileId: string;
	private attachments: File[] = [];
	private domCleanups: Array<() => void> = [];

	constructor(app: App, private readonly options: DeepResearchModalOptions) {
		super(app);
		this.selectedProfileId = options.profiles.some((profile) => profile.id === options.defaultProfileId)
			? options.defaultProfileId
			: options.profiles[0]?.id ?? '';
	}

	onOpen(): void {
		this.setTitle('深度研究');
		this.modalEl.addClass('agent-dashboard-ai-chat-modal', 'agent-dashboard-deep-research-modal');
		if (!Platform.isDesktop) {
			this.contentEl.createEl('p', { text: '本地 AI 工具只能在桌面版 Obsidian 中运行。' });
			return;
		}
		this.contentEl.createEl('p', {
			cls: 'agent-dashboard-ai-chat-intro',
			text: 'Xboard 会先把结果保存在数据区，再由你决定是否放入正式知识库。请选择研究任务模板并添加参考材料。',
		});
		this.renderControls();
		this.activityView = new AiActivityView(this.contentEl);
		const composer = this.contentEl.createDiv({ cls: 'agent-dashboard-ai-composer' });
		this.inputEl = composer.createEl('textarea', {
			attr: {
				placeholder: '输入研究问题；Enter 开始，Shift + Enter 换行',
				'aria-label': '研究问题',
				rows: '6',
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
		this.sendEl = actions.createEl('button', {
			cls: 'mod-cta agent-dashboard-ai-send',
			attr: { type: 'button', 'aria-label': '开始深度研究' },
		});
		const icon = this.sendEl.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(icon, 'send');
		this.sendEl.createSpan({ text: '开始研究' });
		this.registerDomEvent(this.sendEl, 'click', () => void this.runResearch());
		this.registerDomEvent(this.cancelEl, 'click', () => {
			this.options.service.cancelActiveRun();
			this.statusEl.setText('正在停止…');
		});
		this.registerDomEvent(this.inputEl, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				void this.runResearch();
			}
		});
		this.updateRunningState();
		this.inputEl.focus();
	}

	onClose(): void {
		if (this.running) this.options.service.cancelActiveRun();
		this.activityView?.destroy();
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

	private renderControls(): void {
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
	}

	private async runResearch(): Promise<void> {
		const question = this.inputEl.value.trim();
		if (!question || this.running) {
			if (!question) this.inputEl.focus();
			return;
		}
		this.running = true;
		this.statusEl.setText('AI 正在研究，这可能需要几分钟…');
		this.activityView.start('正在准备研究任务');
		this.updateRunningState();
		try {
			const result = await this.options.service.runAgentTask(
				'deep-research',
				{ titleHint: question, content: question },
				this.selectedProfileId,
				await this.filesToAttachments(),
				(activity) => this.activityView.update(activity),
			);
			this.activityView.finish('waiting-confirmation', '研究结果已生成，等待你确认保存');
			this.statusEl.setText(`已生成，耗时 ${this.formatDuration(result.durationMs)}`);
			this.options.onResult(
				result,
				`深度研究 ${question.slice(0, 50)}`,
				(decision) => this.activityView.finish(
					'completed',
					decision === 'published' ? '研究结果已保存到正式知识库' : '研究结果已保留在 Xboard 数据区',
				),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : '深度研究运行失败。';
			this.activityView.finish(
				message.includes('取消') ? 'cancelled' : 'failed',
				message.includes('取消') ? '研究任务已取消' : '研究任务运行失败',
				message,
			);
			this.statusEl.setText(message);
			new Notice(message);
		} finally {
			this.running = false;
			this.updateRunningState();
		}
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
	}

	private currentProfile(): AiProfile | undefined {
		return this.options.profiles.find((profile) => profile.id === this.selectedProfileId);
	}

	private warnAboutAttachmentSupport(): void {
		if (this.attachments.length === 0) return;
		if (this.currentProfile()?.attachmentSupport === 'auto') {
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

	private formatDuration(durationMs: number): string {
		const seconds = Math.max(1, Math.round(durationMs / 1000));
		return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
	}
}
