import {
	AbstractInputSuggest,
	App,
	Modal,
	Notice,
	normalizePath,
	Setting,
	TFile,
	TFolder,
} from 'obsidian';
import {
	QUICK_NOTE_FIELD_TYPE_OPTIONS,
	QUICK_NOTE_ICON_OPTIONS,
} from '../quick-notes/defaults';
import type {
	QuickNoteDefinition,
	QuickNoteFieldDefinition,
} from '../quick-notes/types';
import { QuickNoteFieldModal } from './QuickNoteFieldModal';

interface QuickNoteConfigModalOptions {
	definition: QuickNoteDefinition;
	onSave: (definition: QuickNoteDefinition) => Promise<void>;
}

class QuickNoteFolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly onPathSelect: (path: string) => void,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFolder[] {
		const normalized = query.trim().toLocaleLowerCase();
		return this.app.vault.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder)
			.filter((folder) => folder.path !== '/' && folder.path.toLocaleLowerCase().includes(normalized))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.onPathSelect(folder.path);
		this.close();
	}
}

class QuickNoteTemplateSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly onPathSelect: (path: string) => void,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFile[] {
		const normalized = query.trim().toLocaleLowerCase();
		return this.app.vault.getMarkdownFiles()
			.filter((file) => file.path.toLocaleLowerCase().includes(normalized))
			.slice(0, 50);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.setValue(file.path);
		this.onPathSelect(file.path);
		this.close();
	}
}

export class QuickNoteConfigModal extends Modal {
	private draft: QuickNoteDefinition;
	private fieldsEl: HTMLElement | null = null;
	private firstInput: HTMLInputElement | null = null;
	private submitting = false;

	constructor(app: App, private readonly options: QuickNoteConfigModalOptions) {
		super(app);
		this.draft = {
			...options.definition,
			fields: options.definition.fields.map((field) => ({ ...field, options: [...field.options] })),
		};
	}

	onOpen(): void {
		this.modalEl.addClass('agent-dashboard-quick-note-config-modal');
		this.titleEl.setText('编辑快速笔记');
		this.contentEl.createEl('p', {
			cls: 'agent-dashboard-modal-description',
			text: '选择模板和保存位置，再决定创建笔记时需要填写哪些内容。',
		});

		new Setting(this.contentEl)
			.setName('名称')
			.addText((text) => {
				this.firstInput = text.inputEl;
				text.setPlaceholder('例如：读书笔记')
					.setValue(this.draft.name)
					.onChange((value) => {
						this.draft.name = value;
					});
			});

		new Setting(this.contentEl)
			.setName('图标')
			.addDropdown((dropdown) => {
				for (const option of QUICK_NOTE_ICON_OPTIONS) dropdown.addOption(option.value, option.label);
				dropdown.setValue(this.draft.icon).onChange((value) => {
					this.draft.icon = value;
				});
			});

		new Setting(this.contentEl)
			.setName('模板文件')
			.setDesc('可留空，使用包含标题和内容的简单模板。')
			.addText((text) => {
				text.setPlaceholder('选择知识库中的 Markdown 模板')
					.setValue(this.draft.templatePath)
					.onChange((value) => {
						this.draft.templatePath = value.trim();
					});
				new QuickNoteTemplateSuggest(this.app, text.inputEl, (path) => {
					this.draft.templatePath = path;
				});
			});

		new Setting(this.contentEl)
			.setName('保存到')
			.setDesc('必须选择知识库中已经存在的文件夹。')
			.addText((text) => {
				text.setPlaceholder('选择保存目录')
					.setValue(this.draft.destinationFolder)
					.onChange((value) => {
						this.draft.destinationFolder = value.trim();
					});
				new QuickNoteFolderSuggest(this.app, text.inputEl, (path) => {
					this.draft.destinationFolder = path;
				});
			});

		new Setting(this.contentEl)
			.setName('文件名规则')
			.setDesc('可以使用 {{date}}、{{time}}、{{timeCompact}} 和填写项变量。')
			.addText((text) => text
				.setPlaceholder('{{date}}-{{timeCompact}} {{title}}')
				.setValue(this.draft.fileNameTemplate)
				.onChange((value) => {
					this.draft.fileNameTemplate = value;
				}));

		new Setting(this.contentEl)
			.setName('固定到顶部')
			.setDesc('最多固定 3 个快速笔记。')
			.addToggle((toggle) => toggle
				.setValue(this.draft.pinned)
				.onChange((value) => {
					this.draft.pinned = value;
				}));

		new Setting(this.contentEl)
			.setName('创建后打开')
			.addToggle((toggle) => toggle
				.setValue(this.draft.openAfterCreate)
				.onChange((value) => {
					this.draft.openAfterCreate = value;
				}));

		new Setting(this.contentEl).setName('创建时填写').setHeading();
		this.fieldsEl = this.contentEl.createDiv({ cls: 'agent-dashboard-quick-note-fields' });
		this.renderFields();

		new Setting(this.contentEl)
			.setName('添加填写项')
			.setDesc('支持文字、多行文字、日期、下拉选择和开关。')
			.addButton((button) => button
				.setButtonText('添加')
				.onClick(() => this.openFieldEditor(this.createField())));

		const actions = this.contentEl.createDiv({ cls: 'agent-dashboard-modal-actions' });
		const cancel = actions.createEl('button', { text: '取消', attr: { type: 'button' } });
		const save = actions.createEl('button', {
			cls: 'mod-cta',
			text: '保存快速笔记',
			attr: { type: 'button' },
		});
		cancel.addEventListener('click', () => this.close());
		save.addEventListener('click', () => void this.save(save));
		this.firstInput?.focus();
		this.firstInput?.select();
	}

	onClose(): void {
		this.contentEl.empty();
		this.fieldsEl = null;
		this.firstInput = null;
	}

	private renderFields(): void {
		if (!this.fieldsEl) return;
		this.fieldsEl.empty();
		if (this.draft.fields.length === 0) {
			this.fieldsEl.createEl('p', {
				cls: 'agent-dashboard-setting-empty',
				text: '创建时不需要填写内容，模板将直接生成笔记。',
			});
			return;
		}
		for (const [index, field] of this.draft.fields.entries()) {
			const typeLabel = QUICK_NOTE_FIELD_TYPE_OPTIONS.find((option) => option.value === field.type)?.label ?? field.type;
			new Setting(this.fieldsEl)
				.setName(field.label)
				.setDesc(`${typeLabel} · {{${field.variable}}}${field.required ? ' · 必填' : ''}`)
				.addExtraButton((button) => button
					.setIcon('arrow-up')
					.setTooltip('上移')
					.setDisabled(index === 0)
					.onClick(() => this.moveField(index, -1)))
				.addExtraButton((button) => button
					.setIcon('arrow-down')
					.setTooltip('下移')
					.setDisabled(index === this.draft.fields.length - 1)
					.onClick(() => this.moveField(index, 1)))
				.addExtraButton((button) => button
					.setIcon('pencil')
					.setTooltip('编辑')
					.onClick(() => this.openFieldEditor(field)))
				.addExtraButton((button) => button
					.setIcon('trash-2')
					.setTooltip('移除')
					.onClick(() => {
						this.draft.fields.splice(index, 1);
						this.renderFields();
					}));
		}
	}

	private moveField(index: number, offset: -1 | 1): void {
		const nextIndex = index + offset;
		const field = this.draft.fields[index];
		if (!field || nextIndex < 0 || nextIndex >= this.draft.fields.length) return;
		this.draft.fields.splice(index, 1);
		this.draft.fields.splice(nextIndex, 0, field);
		this.renderFields();
	}

	private openFieldEditor(field: QuickNoteFieldDefinition): void {
		new QuickNoteFieldModal(this.app, {
			field,
			onSave: (nextField) => {
				const index = this.draft.fields.findIndex((candidate) => candidate.id === nextField.id);
				if (index >= 0) this.draft.fields[index] = nextField;
				else this.draft.fields.push(nextField);
				this.renderFields();
			},
		}).open();
	}

	private createField(): QuickNoteFieldDefinition {
		return {
			id: `field-${Date.now().toString(36)}`,
			label: '新填写项',
			variable: `field${this.draft.fields.length + 1}`,
			type: 'text',
			required: false,
			placeholder: '',
			defaultValue: '',
			options: [],
		};
	}

	private async save(button: HTMLButtonElement): Promise<void> {
		if (this.submitting) return;
		const name = this.draft.name.trim();
		if (!name) {
			new Notice('请填写快速笔记名称。');
			return;
		}
		if (!this.draft.destinationFolder.trim()) {
			new Notice('请选择保存目录。');
			return;
		}
		const destination = this.app.vault.getAbstractFileByPath(normalizePath(this.draft.destinationFolder.trim()));
		if (!(destination instanceof TFolder)) {
			new Notice('保存目录不存在，请选择知识库中已有的文件夹。');
			return;
		}
		if (this.draft.templatePath.trim()) {
			const template = this.app.vault.getAbstractFileByPath(normalizePath(this.draft.templatePath.trim()));
			if (!(template instanceof TFile) || template.extension.toLocaleLowerCase() !== 'md') {
				new Notice('模板文件不存在或不是 Markdown 文件。');
				return;
			}
		}
		if (!this.draft.fileNameTemplate.trim()) {
			new Notice('请填写文件名规则。');
			return;
		}
		const variables = new Set<string>();
		for (const field of this.draft.fields) {
			if (variables.has(field.variable)) {
				new Notice(`模板变量“${field.variable}”重复，请修改。`);
				return;
			}
			variables.add(field.variable);
		}

		this.submitting = true;
		button.disabled = true;
		button.setText('正在保存…');
		try {
			await this.options.onSave({
				...this.draft,
				name,
				templatePath: this.draft.templatePath.trim(),
				destinationFolder: this.draft.destinationFolder.trim(),
				fileNameTemplate: this.draft.fileNameTemplate.trim(),
				fields: this.draft.fields.map((field) => ({ ...field, options: [...field.options] })),
			});
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存快速笔记失败。');
			button.disabled = false;
			button.setText('保存快速笔记');
			this.submitting = false;
		}
	}
}
