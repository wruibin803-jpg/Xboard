import {
	App,
	Modal,
	Notice,
	Setting,
} from 'obsidian';
import type {
	QuickNoteDefinition,
	QuickNoteFieldValue,
	QuickNoteValues,
} from '../quick-notes/types';

interface QuickNoteModalOptions {
	definition: QuickNoteDefinition;
	onSubmit: (values: QuickNoteValues) => Promise<void>;
}

export class QuickNoteModal extends Modal {
	private readonly values: QuickNoteValues = {};
	private firstInput: HTMLInputElement | HTMLTextAreaElement | null = null;
	private submitting = false;

	constructor(app: App, private readonly options: QuickNoteModalOptions) {
		super(app);
	}

	onOpen(): void {
		const { definition } = this.options;
		this.modalEl.addClass('agent-dashboard-quick-note-modal');
		this.titleEl.setText(definition.name);
		this.contentEl.createEl('p', {
			cls: 'agent-dashboard-modal-description',
			text: '填写完成后，插件会套用模板并新建笔记。',
		});

		for (const field of definition.fields) {
			const initialValue = this.resolveDefaultValue(field.defaultValue);
			this.values[field.variable] = initialValue;
			const setting = new Setting(this.contentEl).setName(field.label);
			if (field.required) setting.setDesc('必填');

			if (field.type === 'textarea') {
				setting.addTextArea((textArea) => {
					textArea.setPlaceholder(field.placeholder).setValue(String(initialValue));
					textArea.inputEl.rows = 6;
					textArea.onChange((value) => {
						this.values[field.variable] = value;
					});
					this.captureFirstInput(textArea.inputEl);
				});
				continue;
			}

			if (field.type === 'select') {
				setting.addDropdown((dropdown) => {
					for (const option of field.options) dropdown.addOption(option, option);
					const selected = String(initialValue || field.options[0] || '');
					dropdown.setValue(selected).onChange((value) => {
						this.values[field.variable] = value;
					});
					this.values[field.variable] = selected;
					this.captureFirstInput(dropdown.selectEl);
				});
				continue;
			}

			if (field.type === 'toggle') {
				setting.addToggle((toggle) => toggle
					.setValue(Boolean(initialValue))
					.onChange((value) => {
						this.values[field.variable] = value;
					}));
				continue;
			}

			setting.addText((text) => {
				text.setPlaceholder(field.placeholder).setValue(String(initialValue));
				if (field.type === 'date') text.inputEl.type = 'date';
				text.onChange((value) => {
					this.values[field.variable] = value;
				});
				this.captureFirstInput(text.inputEl);
			});
		}

		const actions = this.contentEl.createDiv({ cls: 'agent-dashboard-modal-actions' });
		const cancel = actions.createEl('button', { text: '取消', attr: { type: 'button' } });
		const submit = actions.createEl('button', {
			cls: 'mod-cta',
			text: '创建笔记',
			attr: { type: 'button' },
		});
		this.scope.register(['Mod'], 'Enter', () => {
			void this.submit(submit);
			return false;
		});
		cancel.addEventListener('click', () => this.close());
		submit.addEventListener('click', () => void this.submit(submit));
		this.firstInput?.focus();
		if (this.firstInput?.instanceOf(HTMLInputElement) && this.firstInput.type === 'text') this.firstInput.select();
	}

	onClose(): void {
		this.contentEl.empty();
		this.firstInput = null;
	}

	private async submit(button: HTMLButtonElement): Promise<void> {
		if (this.submitting) return;
		const missing = this.options.definition.fields.find((field) => {
			if (!field.required) return false;
			const value = this.values[field.variable];
			return typeof value === 'boolean' ? !value : !value?.trim();
		});
		if (missing) {
			new Notice(`请填写“${missing.label}”。`);
			return;
		}

		this.submitting = true;
		button.disabled = true;
		button.setText('正在创建…');
		try {
			await this.options.onSubmit({ ...this.values });
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '创建笔记失败。');
			button.disabled = false;
			button.setText('创建笔记');
			this.submitting = false;
		}
	}

	private captureFirstInput(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
		if (!this.firstInput && (input.instanceOf(HTMLInputElement) || input.instanceOf(HTMLTextAreaElement))) {
			this.firstInput = input;
		}
	}

	private resolveDefaultValue(value: QuickNoteFieldValue): QuickNoteFieldValue {
		if (typeof value === 'boolean') return value;
		const now = new Date();
		const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
		return value
			.replaceAll('{{date}}', date)
			.replaceAll('{{time}}', time)
			.replaceAll('{{datetime}}', now.toISOString());
	}
}
