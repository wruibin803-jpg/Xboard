import { App, Modal, Notice, Setting, TextAreaComponent, TextComponent } from 'obsidian';
import type {
	DashboardTaskInput,
	DashboardTaskKind,
	DashboardTaskPriority,
} from '../services/DashboardTaskService';

interface TaskModalOptions {
	date: string;
	onSubmit: (input: DashboardTaskInput) => Promise<void>;
}

export class TaskModal extends Modal {
	private titleInput: TextComponent | null = null;
	private noteInput: TextAreaComponent | null = null;
	private kind: DashboardTaskKind = 'todo';
	private priority: DashboardTaskPriority = 'medium';
	private submitting = false;

	constructor(app: App, private readonly options: TaskModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('agent-dashboard-task-modal');
		this.titleEl.setText('新建日历事项');

		new Setting(this.contentEl)
			.setName('事项名称')
			.addText((text) => {
				this.titleInput = text;
				text.setPlaceholder('输入待办或截止事项');
			});

		new Setting(this.contentEl)
			.setName('类型')
			.addDropdown((dropdown) => dropdown
				.addOption('todo', '待办')
				.addOption('ddl', 'DDL')
				.setValue(this.kind)
				.onChange((value) => {
					this.kind = value as DashboardTaskKind;
				}));

		new Setting(this.contentEl)
			.setName('日期')
			.addText((text) => {
				text.setValue(this.options.date);
				text.inputEl.type = 'date';
				text.setDisabled(true);
			});

		new Setting(this.contentEl)
			.setName('优先级')
			.addDropdown((dropdown) => dropdown
				.addOption('high', '高')
				.addOption('medium', '中')
				.addOption('low', '低')
				.setValue(this.priority)
				.onChange((value) => {
					this.priority = value as DashboardTaskPriority;
				}));

		new Setting(this.contentEl)
			.setName('备注')
			.addTextArea((textArea) => {
				this.noteInput = textArea;
				textArea.setPlaceholder('可选');
				textArea.inputEl.rows = 4;
			});

		const actions = this.contentEl.createDiv({ cls: 'agent-dashboard-modal-actions' });
		const cancel = actions.createEl('button', { text: '取消', attr: { type: 'button' } });
		const submit = actions.createEl('button', { cls: 'mod-cta', text: '保存事项', attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());
		submit.addEventListener('click', () => void this.submit(submit));
		this.scope.register(['Mod'], 'Enter', () => {
			void this.submit(submit);
			return false;
		});
		this.titleInput?.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		this.titleInput = null;
		this.noteInput = null;
	}

	private async submit(button: HTMLButtonElement): Promise<void> {
		if (this.submitting) return;
		const title = this.titleInput?.getValue().trim() ?? '';
		if (!title) {
			new Notice('请填写事项名称。');
			this.titleInput?.inputEl.focus();
			return;
		}
		this.submitting = true;
		button.disabled = true;
		button.setText('正在保存…');
		try {
			await this.options.onSubmit({
				title,
				note: this.noteInput?.getValue().trim() ?? '',
				dueDate: this.options.date,
				scope: 'daily',
				kind: this.kind,
				priority: this.priority,
			});
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存事项失败。');
			button.disabled = false;
			button.setText('保存事项');
			this.submitting = false;
		}
	}
}
