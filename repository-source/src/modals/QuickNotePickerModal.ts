import { FuzzySuggestModal, type App } from 'obsidian';
import type { QuickNoteDefinition } from '../quick-notes/types';

export class QuickNotePickerModal extends FuzzySuggestModal<QuickNoteDefinition> {
	constructor(
		app: App,
		private readonly definitions: QuickNoteDefinition[],
		private readonly onChoose: (definition: QuickNoteDefinition) => void,
	) {
		super(app);
		this.setPlaceholder('选择要创建的笔记');
	}

	getItems(): QuickNoteDefinition[] {
		return this.definitions;
	}

	getItemText(definition: QuickNoteDefinition): string {
		return definition.name;
	}

	onChooseItem(definition: QuickNoteDefinition): void {
		this.onChoose(definition);
	}
}
