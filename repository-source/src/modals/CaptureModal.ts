import { App, Modal, Notice, Setting, TextAreaComponent, TextComponent } from 'obsidian';
import type { CaptureInput, CaptureKind } from '../services/DashboardVaultService';

interface CaptureModalOptions {
	kind: CaptureKind;
	onSubmit: (input: CaptureInput) => Promise<void>;
}

const MODAL_COPY: Record<CaptureKind, { title: string; description: string; button: string }> = {
	diary: {
		title: '新建日记',
		description: '创建一篇全新的日记，并在创建后打开。',
		button: '创建日记',
	},
	'project-log': {
		title: '新建项目日志',
		description: '记录本次项目进展、决定和下一步。',
		button: '创建项目日志',
	},
	inbox: {
		title: '导入到收件箱',
		description: '快速创建一份等待后续整理的临时笔记或资料。',
		button: '创建收件箱笔记',
	},
};

export class CaptureModal extends Modal {
	private titleInput: TextComponent | null = null;
	private contentInput: TextAreaComponent | null = null;
	private inboxType: CaptureInput['inboxType'] = '临时笔记';
	private submitting = false;

	constructor(app: App, private readonly options: CaptureModalOptions) {
		super(app);
	}

	onOpen(): void {
		const copy = MODAL_COPY[this.options.kind];
		this.modalEl.addClass('agent-dashboard-capture-modal');
		this.titleEl.setText(copy.title);
		this.contentEl.createEl('p', { cls: 'agent-dashboard-modal-description', text: copy.description });

		new Setting(this.contentEl)
			.setName('标题')
			.addText((text) => {
				this.titleInput = text;
				text.setPlaceholder(this.defaultTitle()).setValue(this.defaultTitle());
			});

		if (this.options.kind === 'inbox') {
			new Setting(this.contentEl)
				.setName('资料类型')
				.setDesc('帮助之后快速归类。')
				.addDropdown((dropdown) => dropdown
					.addOption('临时笔记', '临时笔记')
					.addOption('资料', '资料')
					.addOption('待整理', '待整理')
					.setValue(this.inboxType ?? '临时笔记')
					.onChange((value) => {
						this.inboxType = value as CaptureInput['inboxType'];
					}));
		}

		new Setting(this.contentEl)
			.setName('内容')
			.setDesc('可以留空，稍后在新笔记中继续编辑。')
			.addTextArea((textArea) => {
				this.contentInput = textArea;
				textArea.setPlaceholder(this.contentPlaceholder());
				textArea.inputEl.rows = 8;
			});

		const actions = this.contentEl.createDiv({ cls: 'agent-dashboard-modal-actions' });
		const cancel = actions.createEl('button', { text: '取消', attr: { type: 'button' } });
		const submit = actions.createEl('button', {
			cls: 'mod-cta',
			text: copy.button,
			attr: { type: 'button' },
		});
		this.scope.register(['Mod'], 'Enter', () => {
			void this.submit(submit);
			return false;
		});
		cancel.addEventListener('click', () => this.close());
		submit.addEventListener('click', () => void this.submit(submit));
		this.titleInput?.inputEl.focus();
		this.titleInput?.inputEl.select();
	}

	onClose(): void {
		this.contentEl.empty();
		this.titleInput = null;
		this.contentInput = null;
	}

	private async submit(button: HTMLButtonElement): Promise<void> {
		if (this.submitting) return;
		const title = this.titleInput?.getValue().trim() ?? '';
		if (!title) {
			new Notice('请填写标题。');
			this.titleInput?.inputEl.focus();
			return;
		}
		this.submitting = true;
		button.disabled = true;
		button.setText('正在创建…');
		try {
			await this.options.onSubmit({
				kind: this.options.kind,
				title,
				content: this.contentInput?.getValue() ?? '',
				inboxType: this.options.kind === 'inbox' ? this.inboxType : undefined,
			});
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '创建笔记失败。');
			button.disabled = false;
			button.setText(MODAL_COPY[this.options.kind].button);
			this.submitting = false;
		}
	}

	private defaultTitle(): string {
		const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
			.format(new Date())
			.replaceAll('/', '-');
		if (this.options.kind === 'diary') return `${date} 日记`;
		if (this.options.kind === 'project-log') return '项目日志';
		return '临时笔记';
	}

	private contentPlaceholder(): string {
		if (this.options.kind === 'diary') return '今天发生了什么？有什么值得记录？';
		if (this.options.kind === 'project-log') return '进展、决定、阻塞和下一步…';
		return '粘贴临时想法、链接、资料摘要或待整理内容…';
	}
}
