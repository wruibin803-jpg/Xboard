import type {
	QuickNoteDefinition,
	QuickNoteFieldDefinition,
	QuickNoteFieldType,
} from './types';

export const QUICK_NOTE_ICON_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: 'notebook-pen', label: '笔记' },
	{ value: 'book-open', label: '阅读' },
	{ value: 'briefcase-business', label: '工作' },
	{ value: 'calendar-days', label: '日程' },
	{ value: 'inbox', label: '收件箱' },
	{ value: 'lightbulb', label: '灵感' },
	{ value: 'file-text', label: '文档' },
];

export const QUICK_NOTE_FIELD_TYPE_OPTIONS: ReadonlyArray<{ value: QuickNoteFieldType; label: string }> = [
	{ value: 'text', label: '单行文字' },
	{ value: 'textarea', label: '多行文字' },
	{ value: 'date', label: '日期' },
	{ value: 'select', label: '下拉选择' },
	{ value: 'toggle', label: '开关' },
];

const TITLE_FIELD: QuickNoteFieldDefinition = {
	id: 'title',
	label: '标题',
	variable: 'title',
	type: 'text',
	required: true,
	placeholder: '输入笔记标题',
	defaultValue: '',
	options: [],
};

const CONTENT_FIELD: QuickNoteFieldDefinition = {
	id: 'content',
	label: '内容',
	variable: 'content',
	type: 'textarea',
	required: false,
	placeholder: '可以留空，稍后在新笔记中继续编辑',
	defaultValue: '',
	options: [],
};

export function createDefaultQuickNotes(
	diaryFolder = '',
	projectLogFolder = '',
	inboxFolder = '',
): QuickNoteDefinition[] {
	return [
		{
			id: 'diary',
			name: '日记',
			icon: 'notebook-pen',
			templatePath: '',
			destinationFolder: diaryFolder,
			fileNameTemplate: '{{date}}',
			openAfterCreate: true,
			pinned: true,
			fields: [
				{ ...TITLE_FIELD, defaultValue: '{{date}} 日记', placeholder: '今天的日记标题' },
				{
					...CONTENT_FIELD,
					placeholder: '今天发生了什么？有什么值得记录？',
				},
			],
		},
		{
			id: 'project-log',
			name: '项目日志',
			icon: 'briefcase-business',
			templatePath: '',
			destinationFolder: projectLogFolder,
			fileNameTemplate: '{{date}}-{{timeCompact}} {{title}}',
			openAfterCreate: true,
			pinned: true,
			fields: [
				{ ...TITLE_FIELD, defaultValue: '项目日志', placeholder: '输入项目或阶段名称' },
				{
					...CONTENT_FIELD,
					placeholder: '记录进展、决定、阻塞和下一步',
				},
			],
		},
		{
			id: 'inbox',
			name: '资料输入',
			icon: 'inbox',
			templatePath: '',
			destinationFolder: inboxFolder,
			fileNameTemplate: '{{date}}-{{timeCompact}} {{title}}',
			openAfterCreate: true,
			pinned: true,
			fields: [
				{ ...TITLE_FIELD, defaultValue: '临时笔记', placeholder: '输入资料标题' },
				{
					id: 'inbox-type',
					label: '资料类型',
					variable: 'inboxType',
					type: 'select',
					required: true,
					placeholder: '',
					defaultValue: '临时笔记',
					options: ['临时笔记', '资料', '待整理'],
				},
				{
					...CONTENT_FIELD,
					placeholder: '粘贴临时想法、链接、资料摘要或待整理内容',
				},
			],
		},
	];
}

export function createBlankQuickNote(): QuickNoteDefinition {
	const now = Date.now().toString(36);
	return {
		id: `quick-note-${now}`,
		name: '新快速笔记',
		icon: 'file-text',
		templatePath: '',
		destinationFolder: '',
		fileNameTemplate: '{{date}}-{{timeCompact}} {{title}}',
		openAfterCreate: true,
		pinned: false,
		fields: [
			{ ...TITLE_FIELD, id: `field-title-${now}` },
			{ ...CONTENT_FIELD, id: `field-content-${now}` },
		],
	};
}

export function cloneQuickNote(definition: QuickNoteDefinition): QuickNoteDefinition {
	const suffix = Date.now().toString(36);
	return {
		...definition,
		id: `${definition.id}-copy-${suffix}`,
		name: `${definition.name}副本`,
		pinned: false,
		fields: definition.fields.map((field, index) => ({
			...field,
			id: `${field.id}-copy-${suffix}-${index}`,
			options: [...field.options],
		})),
	};
}

export function defaultTemplateFor(definition: QuickNoteDefinition): string {
	if (definition.id === 'diary') {
		return [
			'---',
			'type: diary',
			'date: {{date}}',
			'created: {{datetime}}',
			'---',
			'',
			'# {{title}}',
			'',
			'{{content}}',
			'',
		].join('\n');
	}
	if (definition.id === 'project-log') {
		return [
			'---',
			'type: project-log',
			'created: {{datetime}}',
			'---',
			'',
			'# {{title}}',
			'',
			'{{content}}',
			'',
		].join('\n');
	}
	if (definition.id === 'inbox') {
		return [
			'---',
			'type: inbox',
			'inbox-type: {{inboxType}}',
			'status: unprocessed',
			'created: {{datetime}}',
			'---',
			'',
			'# {{title}}',
			'',
			'{{content}}',
			'',
		].join('\n');
	}
	return '# {{title}}\n\n{{content}}\n';
}
