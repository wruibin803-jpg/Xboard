import { App, Modal, Notice, Setting } from 'obsidian';
import { QUICK_NOTE_FIELD_TYPE_OPTIONS } from '../quick-notes/defaults';
import type {
	QuickNoteFieldDefinition,
	QuickNoteFieldType,
} from '../quick-notes/types';

interface QuickNoteFieldModalOptions {
	field: QuickNoteFieldDefinition;
	onSave: (field: QuickNoteFieldDefinition) => void;
}

export class QuickNoteFieldModal extends Modal {
	private draft: QuickNoteFieldDefinition;
	private firstInput: HTMLInputElement | null = null;

	constructor(app: App, private readonly options: QuickNoteFieldModalOptions) {
		super(app);
		this.draft = {
			...options.field,
			options: [...options.field.options],
		};
	}

	onOpen(): void {
		this.modalEl.addClass('agent-dashboard-quick-note-field-modal');
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		this.titleEl.setText('编辑填写项');
		this.contentEl.empty();

		new Setting(this.contentEl)
			.setName('显示名称')
			.setDesc('创建笔记时显示给用户。')
			.addText((text) => {
				this.firstInput = text.inputEl;
				text.setPlaceholder('例如：作者')
					.setValue(this.draft.label)
					.onChange((value) => {
						this.draft.label = value;
					});
			});

		new Setting(this.contentEl)
			.setName('模板变量')
			.setDesc('在模板中使用，例如 {{author}}。')
			.addText((text) => text
				.setPlaceholder('例如 author')
				.setValue(this.draft.variable)
				.onChange((value) => {
					this.draft.variable = value.trim();
				}));

		new Setting(this.contentEl)
			.setName('填写方式')
			.addDropdown((dropdown) => {
				for (const option of QUICK_NOTE_FIELD_TYPE_OPTIONS) dropdown.addOption(option.value, option.label);
				dropdown.setValue(this.draft.type).onChange((value) => {
					this.draft.type = value as QuickNoteFieldType;
					this.draft.defaultValue = value === 'toggle' ? false : '';
					this.render();
				});
			});

		new Setting(this.contentEl)
			.setName('必填')
			.setDesc('未填写时不创建笔记。')
			.addToggle((toggle) => toggle
				.setValue(this.draft.required)
				.onChange((value) => {
					this.draft.required = value;
				}));

		if (this.draft.type !== 'toggle') {
			new Setting(this.contentEl)
				.setName('输入提示')
				.addText((text) => text
					.setPlaceholder('告诉用户应该填写什么')
					.setValue(this.draft.placeholder)
					.onChange((value) => {
						this.draft.placeholder = value;
					}));
		}

		if (this.draft.type === 'select') {
			new Setting(this.contentEl)
				.setName('可选内容')
				.setDesc('每行填写一个选项。')
				.addTextArea((textArea) => {
					textArea.inputEl.rows = 5;
					textArea.setValue(this.draft.options.join('\n')).onChange((value) => {
						this.draft.options = value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean);
					});
				});
		}

		const defaultSetting = new Setting(this.contentEl).setName('默认内容');
		if (this.draft.type === 'toggle') {
			defaultSetting.addToggle((toggle) => toggle
				.setValue(Boolean(this.draft.defaultValue))
				.onChange((value) => {
					this.draft.defaultValue = value;
				}));
		} else {
			defaultSetting.addText((text) => {
				text.setValue(String(this.draft.defaultValue)).onChange((value) => {
					this.draft.defaultValue = value;
				});
				if (this.draft.type === 'date') text.inputEl.type = 'date';
			});
		}

		const actions = this.contentEl.createDiv({ cls: 'agent-dashboard-modal-actions' });
		const cancel = actions.createEl('button', { text: '取消', attr: { type: 'button' } });
		const save = actions.createEl('button', { cls: 'mod-cta', text: '保存填写项', attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());
		save.addEventListener('click', () => this.save());
		this.firstInput?.focus();
		this.firstInput?.select();
	}

	private save(): void {
		const label = this.draft.label.trim();
		const variable = this.draft.variable.trim();
		if (!label) {
			new Notice('请填写显示名称。');
			return;
		}
		if (!variable || !/^[^{}\s]+$/.test(variable)) {
			new Notice('模板变量不能包含空格或大括号。');
			return;
		}
		if (this.draft.type === 'select' && this.draft.options.length === 0) {
			new Notice('请至少填写一个可选内容。');
			return;
		}
		this.options.onSave({
			...this.draft,
			label,
			variable,
			options: [...this.draft.options],
		});
		this.close();
	}
}
