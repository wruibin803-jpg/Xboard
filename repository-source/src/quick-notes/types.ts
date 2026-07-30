export type QuickNoteFieldType = 'text' | 'textarea' | 'date' | 'select' | 'toggle';

export type QuickNoteFieldValue = string | boolean;

export interface QuickNoteFieldDefinition {
	id: string;
	label: string;
	variable: string;
	type: QuickNoteFieldType;
	required: boolean;
	placeholder: string;
	defaultValue: QuickNoteFieldValue;
	options: string[];
}

export interface QuickNoteDefinition {
	id: string;
	name: string;
	icon: string;
	templatePath: string;
	destinationFolder: string;
	fileNameTemplate: string;
	openAfterCreate: boolean;
	pinned: boolean;
	fields: QuickNoteFieldDefinition[];
}

export type QuickNoteValues = Record<string, QuickNoteFieldValue>;
