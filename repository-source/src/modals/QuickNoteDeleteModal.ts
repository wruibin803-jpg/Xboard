import { App, Modal, Notice } from 'obsidian';
import type { QuickNoteDefinition } from '../quick-notes/types';

interface QuickNoteDeleteModalOptions {
	definition: QuickNoteDefinition;
	onConfirm: () => Promise<void>;
}

export class QuickNoteDeleteModal extends Modal {
	constructor(app: App, private readonly options: QuickNoteDeleteModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('agent-dashboard-quick-note-delete-modal');
		this.titleEl.setText('移除快速笔记');
		this.contentEl.createEl('p', {
			cls: 'agent-dashboard-modal-description',
			text: `确定移除“${this.options.definition.name}”吗？模板文件和已经创建的笔记不会删除。`,
		});
		const actions = this.contentEl.createDiv({ cls: 'agent-dashboard-modal-actions' });
		const cancel = actions.createEl('button', { text: '取消', attr: { type: 'button' } });
		const confirm = actions.createEl('button', {
			cls: 'mod-warning',
			text: '移除',
			attr: { type: 'button' },
		});
		cancel.addEventListener('click', () => this.close());
		confirm.addEventListener('click', () => {
			void this.remove(confirm);
		});
		cancel.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async remove(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		button.setText('正在移除…');
		try {
			await this.options.onConfirm();
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '移除快速笔记失败。');
			button.disabled = false;
			button.setText('移除');
		}
	}
}
