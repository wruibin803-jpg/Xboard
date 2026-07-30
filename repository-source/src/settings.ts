import { AbstractInputSuggest, App, normalizePath, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';
import type AgentDashboardPlugin from './main';
import { DEFAULT_CARD_ORDER, DEFAULT_CARD_SIZES } from './cards/registry';
import type { DashboardCardId, DashboardCardSize } from './cards/types';
import {
	cloneQuickNote,
	createBlankQuickNote,
	createDefaultQuickNotes,
} from './quick-notes/defaults';
import type {
	QuickNoteDefinition,
	QuickNoteFieldDefinition,
	QuickNoteFieldType,
	QuickNoteFieldValue,
} from './quick-notes/types';
import { QuickNoteConfigModal } from './modals/QuickNoteConfigModal';
import { QuickNoteDeleteModal } from './modals/QuickNoteDeleteModal';
import { RssSubscriptionModal } from './modals/RssSubscriptionModal';
import { RssSubscriptionDeleteModal } from './modals/RssSubscriptionDeleteModal';
import { createBlankRssSubscription } from './rss/defaults';
import type { RssSubscription } from './rss/types';
import {
	customAiArgumentsFor,
	cloneAiProfile,
	createBlankAiProfile,
	createDefaultAiProfiles,
	DEFAULT_CUSTOM_AI_ARGUMENTS,
	DEFAULT_DEEP_RESEARCH_PROMPT,
} from './ai/defaults';
import type {
	AiDetectedTool,
	AiExecutableMode,
	AiPermissionMode,
	AiProfile,
	AiProviderKind,
	AiReadScope,
	AiReasoningEffort,
	AiToolId,
} from './ai/types';
import { AiProfileModal } from './modals/AiProfileModal';

export type { DashboardCardId, DashboardCardSize } from './cards/types';

const KNOWN_CARD_IDS = new Set<string>(DEFAULT_CARD_ORDER);

export type DashboardSize = 'tiny' | 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge';
export type DashboardDensity = 'comfortable' | 'dense';
export type DashboardTheme =
	| 'forest'
	| 'mist'
	| 'clay'
	| 'indigo'
	| 'graphite'
	| 'citrus'
	| 'coral'
	| 'violet'
	| 'midnight';
export type DashboardCoverMode = 'card' | 'fade';
export interface DashboardCrop {
	zoom: number;
	x: number;
	y: number;
}

export interface AgentDashboardSettings {
	configVersion: 7;
	fontFamily: string;
	size: DashboardSize;
	density: DashboardDensity;
	bubbleFontFamily: string;
	bubbleSize: number;
	theme: DashboardTheme;
	greeting: string;
	coverMode: DashboardCoverMode;
	coverCrop: DashboardCrop;
	avatarCrop: DashboardCrop;
	galleryCrop: DashboardCrop;
	diaryFolder: string;
	projectLogFolder: string;
	inboxFolder: string;
	inspirationFolder: string;
	quickNotes: QuickNoteDefinition[];
	xboardDataFolder: string;
	rssRetentionDays: number;
	rssMaxItemsPerFeed: number;
	rssAutoRefresh: boolean;
	rssRefreshIntervalMinutes: number;
	rssSubscriptions: RssSubscription[];
	aiEnabled: boolean;
	aiProvider: AiProviderKind;
	aiExecutableMode: AiExecutableMode;
	aiAutoTool: AiToolId;
	aiExecutable: string;
	aiCustomArguments: string;
	aiModel: string;
	aiPermissionMode: AiPermissionMode;
	aiTimeoutMinutes: number;
	aiProfiles: AiProfile[];
	aiDefaultChatProfileId: string;
	aiDefaultResearchProfileId: string;
	aiPublishFolder: string;
	deepResearchPrompt: string;
	taskFilePath: string;
	openOnStartup: boolean;
	openWhenEmpty: boolean;
	pomodoroDate: string;
	pomodoroRounds: number;
	cardOrder: DashboardCardId[];
	cardSizes: Record<DashboardCardId, DashboardCardSize>;
}

const DEFAULT_CROP: DashboardCrop = { zoom: 100, x: 50, y: 50 };

export const DEFAULT_SETTINGS: AgentDashboardSettings = {
	configVersion: 7,
	fontFamily: 'Noto Sans SC',
	size: 'medium',
	density: 'dense',
	bubbleFontFamily: 'Microsoft YaHei UI',
	bubbleSize: 13,
	theme: 'forest',
	greeting: '你好！Xboarder！',
	coverMode: 'card',
	coverCrop: { ...DEFAULT_CROP },
	avatarCrop: { ...DEFAULT_CROP },
	galleryCrop: { ...DEFAULT_CROP },
	diaryFolder: '',
	projectLogFolder: '',
	inboxFolder: '',
	inspirationFolder: '',
	quickNotes: createDefaultQuickNotes(),
	xboardDataFolder: 'Xboard 数据',
	rssRetentionDays: 30,
	rssMaxItemsPerFeed: 200,
	rssAutoRefresh: false,
	rssRefreshIntervalMinutes: 60,
	rssSubscriptions: [],
	aiEnabled: false,
	aiProvider: 'codex-cli',
	aiExecutableMode: 'auto',
	aiAutoTool: 'opencode',
	aiExecutable: 'codex',
	aiCustomArguments: DEFAULT_CUSTOM_AI_ARGUMENTS,
	aiModel: '',
	aiPermissionMode: 'xboard-only',
	aiTimeoutMinutes: 30,
	aiProfiles: createDefaultAiProfiles(),
	aiDefaultChatProfileId: 'quick-chat',
	aiDefaultResearchProfileId: 'deep-research',
	aiPublishFolder: '',
	deepResearchPrompt: DEFAULT_DEEP_RESEARCH_PROMPT,
	taskFilePath: 'Xboard 待办.md',
	openOnStartup: false,
	openWhenEmpty: false,
	pomodoroDate: '',
	pomodoroRounds: 0,
	cardOrder: [...DEFAULT_CARD_ORDER],
	cardSizes: { ...DEFAULT_CARD_SIZES },
};

export function normalizeSettings(value: unknown): AgentDashboardSettings {
	const raw = isRecord(value) ? value : {};
	const rawOrder = Array.isArray(raw.cardOrder) ? raw.cardOrder : [];
	const knownOrder = rawOrder.filter((id): id is DashboardCardId => typeof id === 'string' && KNOWN_CARD_IDS.has(id));
	const order = [...new Set([...knownOrder, ...DEFAULT_CARD_ORDER])];
	const rawSizes: Record<string, unknown> = isRecord(raw.cardSizes) ? raw.cardSizes : {};
	const cardSizes = { ...DEFAULT_CARD_SIZES };
	for (const id of DEFAULT_CARD_ORDER) {
		const size = rawSizes[id];
		if (size === 'compact' || size === 'standard' || size === 'wide') cardSizes[id] = size;
	}
	const diaryFolder = optionalText(raw.diaryFolder);
	const projectLogFolder = optionalText(raw.projectLogFolder);
	const inboxFolder = optionalText(raw.inboxFolder);
	const aiExecutable = textValue(raw.aiExecutable, DEFAULT_SETTINGS.aiExecutable);
	const aiExecutableMode = raw.aiExecutableMode === 'auto' || raw.aiExecutableMode === 'manual'
		? raw.aiExecutableMode
		: isDefaultCodexCommand(aiExecutable) ? 'auto' : 'manual';
	const aiProfiles = normalizeAiProfiles(raw.aiProfiles, {
		tool: raw.aiProvider === 'custom-cli' && isAiToolId(raw.aiAutoTool) ? raw.aiAutoTool : 'codex',
		executableMode: aiExecutableMode,
		executable: aiExecutable,
		customArguments: typeof raw.aiCustomArguments === 'string'
			? raw.aiCustomArguments
			: DEFAULT_SETTINGS.aiCustomArguments,
		model: optionalText(raw.aiModel),
		permissionMode: raw.aiPermissionMode === 'full-access' ? 'full-access' : 'xboard-only',
		timeoutMinutes: Math.round(clampNumber(raw.aiTimeoutMinutes, 1, 120, DEFAULT_SETTINGS.aiTimeoutMinutes)),
	});
	const profileIds = new Set(aiProfiles.map((profile) => profile.id));
	const defaultChatProfileId = typeof raw.aiDefaultChatProfileId === 'string'
		&& profileIds.has(raw.aiDefaultChatProfileId)
		? raw.aiDefaultChatProfileId
		: aiProfiles[0]!.id;
	const defaultResearchProfileId = typeof raw.aiDefaultResearchProfileId === 'string'
		&& profileIds.has(raw.aiDefaultResearchProfileId)
		? raw.aiDefaultResearchProfileId
		: aiProfiles[1]?.id ?? aiProfiles[0]!.id;
	return {
		...DEFAULT_SETTINGS,
		configVersion: 7,
		fontFamily: textValue(raw.fontFamily, DEFAULT_SETTINGS.fontFamily),
		size: isDashboardSize(raw.size) ? raw.size : DEFAULT_SETTINGS.size,
		density: raw.density === 'comfortable' || raw.density === 'dense' ? raw.density : DEFAULT_SETTINGS.density,
		bubbleFontFamily: textValue(raw.bubbleFontFamily, DEFAULT_SETTINGS.bubbleFontFamily),
		bubbleSize: clampNumber(raw.bubbleSize, 11, 18, DEFAULT_SETTINGS.bubbleSize),
		theme: isDashboardTheme(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
		greeting: normalizeGreeting(raw.greeting),
		coverMode: raw.coverMode === 'fade' || raw.coverMode === 'card' ? raw.coverMode : DEFAULT_SETTINGS.coverMode,
		coverCrop: normalizeCrop(raw.coverCrop),
		avatarCrop: normalizeCrop(raw.avatarCrop),
		galleryCrop: normalizeCrop(raw.galleryCrop),
		diaryFolder,
		projectLogFolder,
		inboxFolder,
		inspirationFolder: optionalText(raw.inspirationFolder),
		quickNotes: normalizeQuickNotes(raw.quickNotes, diaryFolder, projectLogFolder, inboxFolder),
		xboardDataFolder: textValue(raw.xboardDataFolder, DEFAULT_SETTINGS.xboardDataFolder),
		rssRetentionDays: Math.round(clampNumber(raw.rssRetentionDays, 1, 365, DEFAULT_SETTINGS.rssRetentionDays)),
		rssMaxItemsPerFeed: Math.round(clampNumber(raw.rssMaxItemsPerFeed, 20, 1000, DEFAULT_SETTINGS.rssMaxItemsPerFeed)),
		rssAutoRefresh: typeof raw.rssAutoRefresh === 'boolean'
			? raw.rssAutoRefresh
			: DEFAULT_SETTINGS.rssAutoRefresh,
		rssRefreshIntervalMinutes: Math.round(clampNumber(
			raw.rssRefreshIntervalMinutes,
			5,
			1440,
			DEFAULT_SETTINGS.rssRefreshIntervalMinutes,
		)),
		rssSubscriptions: normalizeRssSubscriptions(raw.rssSubscriptions),
		aiEnabled: typeof raw.aiEnabled === 'boolean' ? raw.aiEnabled : DEFAULT_SETTINGS.aiEnabled,
		aiProvider: raw.aiProvider === 'custom-cli' ? 'custom-cli' : 'codex-cli',
		aiExecutableMode,
		aiAutoTool: isAiToolId(raw.aiAutoTool) ? raw.aiAutoTool : DEFAULT_SETTINGS.aiAutoTool,
		aiExecutable,
		aiCustomArguments: typeof raw.aiCustomArguments === 'string'
			? raw.aiCustomArguments
			: DEFAULT_SETTINGS.aiCustomArguments,
		aiModel: optionalText(raw.aiModel),
		aiPermissionMode: raw.aiPermissionMode === 'full-access' ? 'full-access' : 'xboard-only',
		aiTimeoutMinutes: Math.round(clampNumber(raw.aiTimeoutMinutes, 1, 120, DEFAULT_SETTINGS.aiTimeoutMinutes)),
		aiProfiles,
		aiDefaultChatProfileId: defaultChatProfileId,
		aiDefaultResearchProfileId: defaultResearchProfileId,
		aiPublishFolder: optionalText(raw.aiPublishFolder),
		deepResearchPrompt: textValue(raw.deepResearchPrompt, DEFAULT_SETTINGS.deepResearchPrompt),
		taskFilePath: textValue(raw.taskFilePath, DEFAULT_SETTINGS.taskFilePath),
		openOnStartup: typeof raw.openOnStartup === 'boolean' ? raw.openOnStartup : DEFAULT_SETTINGS.openOnStartup,
		openWhenEmpty: typeof raw.openWhenEmpty === 'boolean' ? raw.openWhenEmpty : DEFAULT_SETTINGS.openWhenEmpty,
		pomodoroDate: typeof raw.pomodoroDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.pomodoroDate) ? raw.pomodoroDate : '',
		pomodoroRounds: Math.max(0, Math.floor(numberValue(raw.pomodoroRounds, 0))),
		cardOrder: order,
		cardSizes,
	};
}

function isDefaultCodexCommand(value: string): boolean {
	return value.trim().toLocaleLowerCase() === 'codex'
		|| value.trim().toLocaleLowerCase() === 'codex.exe';
}

function isAiToolId(value: unknown): value is AiToolId {
	return value === 'codex' || value === 'claude' || value === 'gemini' || value === 'opencode';
}

function normalizeAiProfiles(
	value: unknown,
	legacy: Pick<
		AiProfile,
		| 'tool'
		| 'executableMode'
		| 'executable'
		| 'customArguments'
		| 'model'
		| 'permissionMode'
		| 'timeoutMinutes'
	>,
): AiProfile[] {
	if (!Array.isArray(value)) {
		return createDefaultAiProfiles().map((profile) => ({
			...profile,
			...legacy,
			networkAccess: profile.id === 'deep-research',
			reasoningEffort: profile.id === 'deep-research' ? 'high' : 'medium',
		}));
	}
	const seen = new Set<string>();
	const profiles = value.slice(0, 20)
		.map((item, index): AiProfile | null => {
			if (!isRecord(item)) return null;
			const name = optionalText(item.name);
			if (!name || !isAiToolId(item.tool)) return null;
			let id = textValue(item.id, `ai-profile-${index + 1}`);
			if (seen.has(id)) id = `${id}-${index + 1}`;
			seen.add(id);
			return {
				id,
				name,
				tool: item.tool,
				executableMode: item.executableMode === 'manual' ? 'manual' : 'auto',
				executable: textValue(item.executable, item.tool),
				customArguments: typeof item.customArguments === 'string'
					? item.customArguments
					: customAiArgumentsFor(item.tool),
				model: optionalText(item.model),
				reasoningEffort: isAiReasoningEffort(item.reasoningEffort)
					? item.reasoningEffort
					: 'medium',
				networkAccess: typeof item.networkAccess === 'boolean' ? item.networkAccess : false,
				readScope: isAiReadScope(item.readScope) ? item.readScope : 'none',
				readFolder: optionalText(item.readFolder),
				attachmentSupport: item.attachmentSupport === 'supported'
					|| item.attachmentSupport === 'unsupported'
					? item.attachmentSupport
					: 'auto',
				permissionMode: item.permissionMode === 'full-access' ? 'full-access' : 'xboard-only',
				timeoutMinutes: Math.round(clampNumber(item.timeoutMinutes, 1, 120, 30)),
			};
		})
		.filter((profile): profile is AiProfile => profile !== null);
	return profiles.length > 0 ? profiles : createDefaultAiProfiles();
}

function isAiReasoningEffort(value: unknown): value is AiReasoningEffort {
	return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';
}

function isAiReadScope(value: unknown): value is AiReadScope {
	return value === 'none' || value === 'active-note' || value === 'today' || value === 'folder';
}

function normalizeRssSubscriptions(value: unknown): RssSubscription[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value.slice(0, 100)
		.map((item, index): RssSubscription | null => {
			if (!isRecord(item)) return null;
			const name = optionalText(item.name);
			const url = optionalText(item.url);
			if (!name || !url) return null;
			let id = textValue(item.id, `rss-${index + 1}`);
			if (seen.has(id)) id = `${id}-${index + 1}`;
			seen.add(id);
			return {
				id,
				name,
				url,
				category: textValue(item.category, '未分类'),
				enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
			};
		})
		.filter((item): item is RssSubscription => item !== null);
}

function normalizeQuickNotes(
	value: unknown,
	diaryFolder: string,
	projectLogFolder: string,
	inboxFolder: string,
): QuickNoteDefinition[] {
	if (!Array.isArray(value)) return createDefaultQuickNotes(diaryFolder, projectLogFolder, inboxFolder);
	const notes = value
		.map((item, index) => normalizeQuickNote(item, index))
		.filter((item): item is QuickNoteDefinition => item !== null);
	let pinnedCount = 0;
	return notes.map((note) => {
		if (!note.pinned) return note;
		pinnedCount += 1;
		return pinnedCount <= 3 ? note : { ...note, pinned: false };
	});
}

function normalizeQuickNote(value: unknown, index: number): QuickNoteDefinition | null {
	if (!isRecord(value)) return null;
	const name = optionalText(value.name);
	if (!name) return null;
	const id = textValue(value.id, `quick-note-${index + 1}`);
	const fields = Array.isArray(value.fields)
		? value.fields
			.map((field, fieldIndex) => normalizeQuickNoteField(field, fieldIndex))
			.filter((field): field is QuickNoteFieldDefinition => field !== null)
		: [];
	return {
		id,
		name: id === 'inbox' && name === '收件箱导入' ? '资料输入' : name,
		icon: textValue(value.icon, 'file-text'),
		templatePath: optionalText(value.templatePath),
		destinationFolder: optionalText(value.destinationFolder),
		fileNameTemplate: textValue(value.fileNameTemplate, '{{date}}-{{timeCompact}} {{title}}'),
		openAfterCreate: typeof value.openAfterCreate === 'boolean' ? value.openAfterCreate : true,
		pinned: typeof value.pinned === 'boolean' ? value.pinned : false,
		fields,
	};
}

function normalizeQuickNoteField(value: unknown, index: number): QuickNoteFieldDefinition | null {
	if (!isRecord(value)) return null;
	const label = optionalText(value.label);
	const variable = optionalText(value.variable);
	if (!label || !variable || !isQuickNoteFieldType(value.type)) return null;
	const options = Array.isArray(value.options)
		? value.options.filter((option): option is string => typeof option === 'string' && Boolean(option.trim())).map((option) => option.trim())
		: [];
	return {
		id: textValue(value.id, `field-${index + 1}`),
		label,
		variable,
		type: value.type,
		required: typeof value.required === 'boolean' ? value.required : false,
		placeholder: optionalText(value.placeholder),
		defaultValue: normalizeQuickNoteFieldValue(value.defaultValue, value.type),
		options,
	};
}

function normalizeQuickNoteFieldValue(value: unknown, type: QuickNoteFieldType): QuickNoteFieldValue {
	if (type === 'toggle') return typeof value === 'boolean' ? value : false;
	return typeof value === 'string' ? value : '';
}

function isQuickNoteFieldType(value: unknown): value is QuickNoteFieldType {
	return value === 'text' || value === 'textarea' || value === 'date' || value === 'select' || value === 'toggle';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function optionalText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function textValue(value: unknown, fallback: string): string {
	return optionalText(value) || fallback;
}

function normalizeGreeting(value: unknown): string {
	const greeting = optionalText(value);
	return !greeting
		|| greeting === '你好，王瑞彬！'
		|| greeting === '你好！Xboader！'
		|| greeting === '你好xboarder'
		? DEFAULT_SETTINGS.greeting
		: greeting;
}

function numberValue(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
	return Math.min(maximum, Math.max(minimum, numberValue(value, fallback)));
}

function normalizeCrop(value: unknown): DashboardCrop {
	const crop = isRecord(value) ? value : {};
	return {
		zoom: clampNumber(crop.zoom, 100, 200, DEFAULT_CROP.zoom),
		x: clampNumber(crop.x, 0, 100, DEFAULT_CROP.x),
		y: clampNumber(crop.y, 0, 100, DEFAULT_CROP.y),
	};
}

function isDashboardSize(value: unknown): value is DashboardSize {
	return value === 'tiny' || value === 'small' || value === 'medium' || value === 'large' || value === 'xlarge' || value === 'xxlarge';
}

function isDashboardTheme(value: unknown): value is DashboardTheme {
	return value === 'forest' || value === 'mist' || value === 'clay' || value === 'indigo'
		|| value === 'graphite' || value === 'citrus' || value === 'coral' || value === 'violet' || value === 'midnight';
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly onFolderSelect: (value: string) => void,
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
		this.onFolderSelect(folder.path);
		this.close();
	}
}

export class AgentDashboardSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: AgentDashboardPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('显示偏好').setHeading();

		new Setting(containerEl)
			.setName('欢迎语')
			.setDesc('修改仪表盘顶部主标题。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.greeting)
				.setValue(this.plugin.settings.greeting)
				.onChange(async (value) => this.patch({ greeting: value || DEFAULT_SETTINGS.greeting })));

		new Setting(containerEl)
			.setName('主题色')
			.setDesc('从克制低饱和到明快高饱和，也包含完整深色模式。')
			.addDropdown((dropdown) => dropdown
				.addOption('forest', '松林 · 中饱和绿')
				.addOption('mist', '湖雾 · 低饱和蓝')
				.addOption('clay', '陶土 · 低饱和暖棕')
				.addOption('indigo', '暮蓝 · 中饱和靛蓝')
				.addOption('graphite', '石墨 · 中性灰')
				.addOption('citrus', '青柠 · 高饱和黄绿')
				.addOption('coral', '珊瑚 · 高饱和暖红')
				.addOption('violet', '紫藤 · 高饱和紫')
				.addOption('midnight', '深夜 · 深色模式')
				.setValue(this.plugin.settings.theme)
				.onChange(async (value) => this.patch({ theme: value as DashboardTheme })));

		new Setting(containerEl)
			.setName('界面字体')
			.setDesc('输入系统中已安装字体的准确名称。')
			.addText((text) => text
				.setPlaceholder('输入 Windows 字体名称')
				.setValue(this.plugin.settings.fontFamily)
				.onChange(async (value) => this.patch({ fontFamily: value })));

		new Setting(containerEl)
			.setName('界面字号')
			.setDesc('调整所有卡片的基础字号。')
			.addDropdown((dropdown) => dropdown
				.addOption('tiny', '较小 · 13 px')
				.addOption('small', '小号 · 14 px')
				.addOption('medium', '标准 · 16 px')
				.addOption('large', '大号 · 18 px')
				.addOption('xlarge', '加大 · 20 px')
				.addOption('xxlarge', '特大 · 22 px')
				.setValue(this.plugin.settings.size)
				.onChange(async (value) => this.patch({ size: value as DashboardSize })));

		new Setting(containerEl)
			.setName('布局密度')
			.setDesc('高密度布局整体缩小并增加桌面列数；标准布局保留舒展间距。')
			.addDropdown((dropdown) => dropdown
				.addOption('dense', '高密度')
				.addOption('comfortable', '标准')
				.setValue(this.plugin.settings.density)
				.onChange(async (value) => this.patch({ density: value as DashboardDensity })));

		new Setting(containerEl).setName('气泡文字').setHeading();

		new Setting(containerEl)
			.setName('气泡字形')
			.setDesc('影响顶部操作、状态胶囊和布局控制，不改变待办正文。')
			.addText((text) => text
				.setPlaceholder('输入气泡字体名称')
				.setValue(this.plugin.settings.bubbleFontFamily)
				.onChange(async (value) => this.patch({ bubbleFontFamily: value })));

		new Setting(containerEl)
			.setName('气泡字号')
			.setDesc('调整顶部操作、状态胶囊和布局控制的字号。')
			.addSlider((slider) => slider
				.setLimits(11, 18, 1)
				.setDynamicTooltip()
				.setValue(this.plugin.settings.bubbleSize)
				.onChange(async (value) => this.patch({ bubbleSize: value })));

		new Setting(containerEl).setName('顶部背景').setHeading();

		new Setting(containerEl)
			.setName('呈现方式')
			.setDesc('在气泡卡片与向下渐变融入背景之间切换。')
			.addDropdown((dropdown) => dropdown
				.addOption('card', '气泡卡片')
				.addOption('fade', '渐变融入')
				.setValue(this.plugin.settings.coverMode)
				.onChange(async (value) => this.patch({ coverMode: value as DashboardCoverMode })));

		new Setting(containerEl).setName('图片裁剪').setHeading();
		this.addCropControls(containerEl, '顶部背景', 'coverCrop');
		this.addCropControls(containerEl, '头像', 'avatarCrop');
		this.addCropControls(containerEl, '相框照片', 'galleryCrop');

		this.renderQuickNotes(containerEl);
		this.renderRssSettings(containerEl);
		this.renderAiSettings(containerEl);

		new Setting(containerEl).setName('知识库目录').setHeading();
		this.addFolderSetting(containerEl, '收件箱统计目录', '积压数量会递归统计其中的全部文件；收件箱快速笔记的保存位置可以单独设置。', 'inboxFolder');
		this.addFolderSetting(containerEl, '灵感库目录', '每日灵感记录保存的位置。', 'inspirationFolder');

		new Setting(containerEl).setName('任务与启动').setHeading();
		const taskFileSetting = new Setting(containerEl)
			.setName('任务文件')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.taskFilePath)
				.setValue(this.plugin.settings.taskFilePath)
				.onChange(async (value) => {
					this.updateTaskFileDescription(taskFileSetting, value);
					await this.patch({ taskFilePath: value });
				}));
		this.updateTaskFileDescription(taskFileSetting, this.plugin.settings.taskFilePath);

		new Setting(containerEl)
			.setName('启动时打开工作台')
			.setDesc('Obsidian 完成布局加载后打开工作台，并自动刷新一次。')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.openOnStartup)
				.onChange(async (value) => this.patch({ openOnStartup: value })));

		new Setting(containerEl)
			.setName('关闭所有页面后打开工作台')
			.setDesc('主编辑区没有其他页面时打开工作台，并自动刷新一次。')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.openWhenEmpty)
				.onChange(async (value) => this.patch({ openWhenEmpty: value })));

		new Setting(containerEl).setName('卡片布局').setHeading();
		new Setting(containerEl)
			.setName('恢复推荐布局')
			.setDesc('紧凑、标准、加宽分别占 1×1、1×2、1×3；卡片在仪表盘中可拖动排序。')
			.addButton((button) => button
				.setButtonText('恢复')
				.onClick(async () => this.patch({
					cardOrder: [...DEFAULT_CARD_ORDER],
					cardSizes: { ...DEFAULT_CARD_SIZES },
				})));
	}

	private renderAiSettings(container: HTMLElement): void {
		new Setting(container).setName('AI 自动工作流').setHeading();
		new Setting(container)
			.setName('允许运行 AI 自动工作流')
			.setDesc('关闭时，插件不会启动任何本地 AI 程序。所有任务都需要你手动点击。')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.aiEnabled)
				.onChange(async (value) => this.patch({ aiEnabled: value })));

		new Setting(container)
			.setName('AI 临时对话默认任务模板')
			.setDesc('打开临时对话时会先选中这个任务模板，发送前仍可切换。')
			.addDropdown((dropdown) => dropdown
				.addOptions(Object.fromEntries(this.plugin.settings.aiProfiles
					.map((profile) => [profile.id, profile.name])))
				.setValue(this.plugin.settings.aiDefaultChatProfileId)
				.onChange(async (value) => this.patch({ aiDefaultChatProfileId: value })));

		new Setting(container)
			.setName('深度研究默认任务模板')
			.setDesc('深度研究通常适合允许联网、思考更深入的任务模板。')
			.addDropdown((dropdown) => dropdown
				.addOptions(Object.fromEntries(this.plugin.settings.aiProfiles
					.map((profile) => [profile.id, profile.name])))
				.setValue(this.plugin.settings.aiDefaultResearchProfileId)
				.onChange(async (value) => this.patch({ aiDefaultResearchProfileId: value })));

		new Setting(container)
			.setName('AI 工作流任务模板')
			.setDesc('每个任务模板保存工具、模型、思考强度、联网、读取范围、附件能力和运行时间。')
			.addButton((button) => button
				.setButtonText('添加任务模板')
				.setCta()
				.onClick(() => this.editAiProfile(createBlankAiProfile())));

		for (const profile of this.plugin.settings.aiProfiles) {
			new Setting(container)
				.setName(profile.name)
				.setDesc(this.aiProfileSummary(profile))
				.addExtraButton((button) => button
					.setIcon('pencil')
					.setTooltip('编辑任务模板')
					.onClick(() => this.editAiProfile(profile)))
				.addExtraButton((button) => button
					.setIcon('copy')
					.setTooltip('复制任务模板')
					.onClick(() => this.editAiProfile(cloneAiProfile(profile))))
				.addExtraButton((button) => button
					.setIcon('trash-2')
					.setTooltip('删除任务模板')
					.setDisabled(this.plugin.settings.aiProfiles.length <= 1)
					.onClick(() => void this.removeAiProfile(profile.id)));
		}

		const publishSetting = new Setting(container)
			.setName('正式结果默认保存目录')
			.setDesc('AI 完成后仍会再问你一次；只有确认后才会复制到这个目录。');
		const savePublishFolder = async (value: string): Promise<void> => {
			await this.patch({ aiPublishFolder: value });
		};
		publishSetting.addText((text) => {
			text.setPlaceholder('选择正式知识库中的已有目录')
				.setValue(this.plugin.settings.aiPublishFolder)
				.onChange(savePublishFolder);
			new FolderSuggest(this.app, text.inputEl, (value) => void savePublishFolder(value));
		});

		new Setting(container)
			.setName('深度研究说明')
			.setDesc('这是每次深度研究都会交给 AI 的固定要求，可以改成你习惯的研究方法或任务模板名称。')
			.addTextArea((text) => text
				.setPlaceholder(DEFAULT_DEEP_RESEARCH_PROMPT)
				.setValue(this.plugin.settings.deepResearchPrompt)
				.onChange(async (value) => this.patch({
					deepResearchPrompt: value || DEFAULT_DEEP_RESEARCH_PROMPT,
					})));
	}

	private editAiProfile(profile: AiProfile): void {
		new AiProfileModal(this.app, {
			profile,
			onSave: async (saved) => {
				const profiles = [...this.plugin.settings.aiProfiles];
				const index = profiles.findIndex((candidate) => candidate.id === saved.id);
				if (index >= 0) profiles[index] = saved;
				else profiles.push(saved);
				await this.patch({ aiProfiles: profiles });
				this.display();
			},
		}).open();
	}

	private async removeAiProfile(profileId: string): Promise<void> {
		if (this.plugin.settings.aiProfiles.length <= 1) return;
		const profiles = this.plugin.settings.aiProfiles.filter((profile) => profile.id !== profileId);
		const fallback = profiles[0]!.id;
		await this.patch({
			aiProfiles: profiles,
			aiDefaultChatProfileId: this.plugin.settings.aiDefaultChatProfileId === profileId
				? fallback
				: this.plugin.settings.aiDefaultChatProfileId,
			aiDefaultResearchProfileId: this.plugin.settings.aiDefaultResearchProfileId === profileId
				? fallback
				: this.plugin.settings.aiDefaultResearchProfileId,
		});
		this.display();
	}

	private aiProfileSummary(profile: AiProfile): string {
		const tool = this.aiToolName(profile.tool);
		const model = profile.model || '默认模型';
		const reasoning = profile.reasoningEffort === 'low'
			? '较快'
			: profile.reasoningEffort === 'medium'
				? '均衡'
				: profile.reasoningEffort === 'high' ? '深入' : '最深入';
		const network = profile.networkAccess ? '可联网' : '不联网';
		return `${tool} · ${model} · ${reasoning} · ${network} · 最长 ${profile.timeoutMinutes} 分钟`;
	}

	private async updateAiDetectionStatus(setting: Setting, force = false): Promise<void> {
		const toolId: AiToolId = this.plugin.settings.aiProvider === 'codex-cli'
			? 'codex'
			: this.plugin.settings.aiAutoTool;
		const toolName = this.aiToolName(toolId);
		setting.setDesc(`正在自动查找 ${toolName}…`);
		setting.settingEl.classList.remove('is-xboard-ai-found', 'is-xboard-ai-missing');
		try {
			const tools = await this.plugin.detectAiTools(force);
			if (!setting.settingEl.isConnected) return;
			const tool = tools.find((candidate) => candidate.id === toolId);
			this.setAiDetectionResult(setting, toolName, tool);
		} catch (error) {
			if (!setting.settingEl.isConnected) return;
			const detail = error instanceof Error ? error.message : '未知错误';
			setting.setDesc(`自动查找遇到问题：${detail}`);
			setting.settingEl.classList.add('is-xboard-ai-missing');
		}
	}

	private setAiDetectionResult(setting: Setting, toolName: string, tool: AiDetectedTool | undefined): void {
		if (tool) {
			setting.setDesc(`已找到 ${toolName}，可以直接使用。`);
			setting.settingEl.classList.add('is-xboard-ai-found');
			setting.settingEl.classList.remove('is-xboard-ai-missing');
			return;
		}
		setting.setDesc(`没有找到 ${toolName}。请先确认已经安装，或改用“手动指定”。`);
		setting.settingEl.classList.add('is-xboard-ai-missing');
		setting.settingEl.classList.remove('is-xboard-ai-found');
	}

	private aiToolName(id: AiToolId): string {
		if (id === 'codex') return 'Codex';
		if (id === 'claude') return 'Claude';
		if (id === 'gemini') return 'Gemini';
		return 'OpenCode';
	}

	private updateAiPermissionDescription(setting: Setting, mode: AiPermissionMode): void {
		setting.setDesc(mode === 'full-access'
			? '危险：Codex 将绕过审批和沙箱，可能访问或修改 Xboard 数据目录以外的文件。其他命令行 AI 的权限由该程序自己决定。'
			: 'Codex 只能写入本次 Xboard 工作目录。其他命令行 AI 无法由 Xboard 强制隔离，请确认它本身的安全设置。');
	}

	private renderRssSettings(container: HTMLElement): void {
		new Setting(container).setName('外部消息来源').setHeading();
		new Setting(container)
			.setName('Xboard 数据目录')
			.setDesc('第一次手动拉取 RSS 时自动建立。这里只保存插件缓存与以后 AI 生成的结果，不计入正式知识库统计。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.xboardDataFolder)
				.setValue(this.plugin.settings.xboardDataFolder)
				.onChange(async (value) => this.patch({
					xboardDataFolder: value || DEFAULT_SETTINGS.xboardDataFolder,
				})));

		new Setting(container)
			.setName('保留最近多少天')
			.setDesc('较旧的 RSS 内容会在下次手动刷新时从缓存中清理。')
			.addSlider((slider) => slider
				.setLimits(1, 365, 1)
				.setDynamicTooltip()
				.setValue(this.plugin.settings.rssRetentionDays)
				.onChange(async (value) => this.patch({ rssRetentionDays: value })));

		new Setting(container)
			.setName('每个订阅最多保留')
			.setDesc('用于限制缓存大小，不会影响订阅网站本身。')
			.addSlider((slider) => slider
				.setLimits(20, 1000, 20)
				.setDynamicTooltip()
				.setValue(this.plugin.settings.rssMaxItemsPerFeed)
				.onChange(async (value) => this.patch({ rssMaxItemsPerFeed: value })));

		new Setting(container)
			.setName('自动刷新外部消息')
			.setDesc('打开后，Obsidian 运行期间会按下方间隔联网更新已启用的来源。')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.rssAutoRefresh)
				.onChange(async (value) => this.patch({ rssAutoRefresh: value })));

		new Setting(container)
			.setName('自动刷新间隔')
			.setDesc('从开启插件或修改设置时开始计时；仍可随时点击卡片里的刷新按钮。')
			.addDropdown((dropdown) => dropdown
				.addOptions({
					'15': '每 15 分钟',
					'30': '每 30 分钟',
					'60': '每 1 小时',
					'180': '每 3 小时',
					'360': '每 6 小时',
					'720': '每 12 小时',
					'1440': '每天',
				})
				.setValue(String(this.plugin.settings.rssRefreshIntervalMinutes))
				.onChange(async (value) => this.patch({ rssRefreshIntervalMinutes: Number(value) })));

		new Setting(container)
			.setName('消息来源')
			.setDesc('手动刷新和自动刷新都会拉取这里已启用的来源。')
			.addButton((button) => button
				.setButtonText('添加来源')
				.setCta()
				.onClick(() => this.editRssSubscription(createBlankRssSubscription())));

		if (this.plugin.settings.rssSubscriptions.length === 0) {
			new Setting(container)
				.setName('还没有外部消息来源')
				.setDesc('点击上方“添加来源”，粘贴你想关注的网站 RSS 或 atom 地址。');
			return;
		}

		for (const subscription of this.plugin.settings.rssSubscriptions) {
			new Setting(container)
				.setName(subscription.name)
				.setDesc(`${subscription.category || '未分类'} · ${subscription.url}`)
				.addToggle((toggle) => toggle
					.setTooltip(subscription.enabled ? '当前已启用' : '当前已停用')
					.setValue(subscription.enabled)
					.onChange(async (enabled) => {
						await this.saveRssSubscription({ ...subscription, enabled });
					}))
				.addExtraButton((button) => button
					.setIcon('pencil')
					.setTooltip('编辑与测试')
					.onClick(() => this.editRssSubscription(subscription)))
				.addExtraButton((button) => button
					.setIcon('trash-2')
					.setTooltip('移除订阅')
					.onClick(() => this.confirmRemoveRssSubscription(subscription)));
		}
	}

	private editRssSubscription(subscription: RssSubscription): void {
		new RssSubscriptionModal(this.app, {
			subscription,
			onTest: (candidate) => this.plugin.testRssSubscription(candidate),
			onSave: async (candidate) => {
				const duplicate = this.plugin.settings.rssSubscriptions.find(
					(item) => item.id !== candidate.id && item.url === candidate.url,
				);
				if (duplicate) throw new Error(`这个地址已经用于“${duplicate.name}”。`);
				await this.saveRssSubscription(candidate);
				this.display();
			},
		}).open();
	}

	private async saveRssSubscription(subscription: RssSubscription): Promise<void> {
		const subscriptions = [...this.plugin.settings.rssSubscriptions];
		const index = subscriptions.findIndex((candidate) => candidate.id === subscription.id);
		if (index >= 0) subscriptions[index] = subscription;
		else subscriptions.push(subscription);
		await this.patch({ rssSubscriptions: subscriptions });
	}

	private confirmRemoveRssSubscription(subscription: RssSubscription): void {
		new RssSubscriptionDeleteModal(this.app, {
			subscription,
			onConfirm: async () => {
				await this.patch({
					rssSubscriptions: this.plugin.settings.rssSubscriptions.filter(
						(candidate) => candidate.id !== subscription.id,
					),
				});
				this.display();
			},
		}).open();
	}

	private renderQuickNotes(container: HTMLElement): void {
		new Setting(container).setName('快速笔记').setHeading();
		new Setting(container)
			.setName('快速新建')
			.setDesc('每种快速笔记都可以选择模板、保存位置、文件名和创建时要填写的内容。')
			.addButton((button) => button
				.setButtonText('添加')
				.setCta()
				.onClick(() => this.editQuickNote(createBlankQuickNote())));

		if (this.plugin.settings.quickNotes.length === 0) {
			new Setting(container)
				.setName('还没有快速笔记')
				.setDesc('添加后，它会出现在仪表盘的“快速新建”列表中。');
			return;
		}

		for (const [index, definition] of this.plugin.settings.quickNotes.entries()) {
			const template = definition.templatePath || '简单模板';
			const destination = definition.destinationFolder || '未选择保存目录';
			new Setting(container)
				.setName(definition.name)
				.setDesc(`${definition.pinned ? '已固定到顶部 · ' : ''}${template} → ${destination}`)
				.addExtraButton((button) => button
					.setIcon('arrow-up')
					.setTooltip('上移')
					.setDisabled(index === 0)
					.onClick(() => void this.moveQuickNote(index, -1)))
				.addExtraButton((button) => button
					.setIcon('arrow-down')
					.setTooltip('下移')
					.setDisabled(index === this.plugin.settings.quickNotes.length - 1)
					.onClick(() => void this.moveQuickNote(index, 1)))
				.addExtraButton((button) => button
					.setIcon('copy')
					.setTooltip('复制')
					.onClick(() => void this.appendQuickNote(cloneQuickNote(definition))))
				.addExtraButton((button) => button
					.setIcon('pencil')
					.setTooltip('编辑')
					.onClick(() => this.editQuickNote(definition)))
				.addExtraButton((button) => button
					.setIcon('trash-2')
					.setTooltip('移除快捷入口')
					.onClick(() => this.confirmRemoveQuickNote(definition)));
		}
	}

	private editQuickNote(definition: QuickNoteDefinition): void {
		new QuickNoteConfigModal(this.app, {
			definition,
			onSave: async (nextDefinition) => {
				const quickNotes = [...this.plugin.settings.quickNotes];
				const index = quickNotes.findIndex((candidate) => candidate.id === nextDefinition.id);
				if (index >= 0) quickNotes[index] = nextDefinition;
				else quickNotes.push(nextDefinition);
				if (quickNotes.filter((candidate) => candidate.pinned).length > 3) {
					throw new Error('最多固定 3 个快速笔记，请先取消其他固定项。');
				}
				await this.patch({ quickNotes });
				this.display();
			},
		}).open();
	}

	private async appendQuickNote(definition: QuickNoteDefinition): Promise<void> {
		await this.patch({ quickNotes: [...this.plugin.settings.quickNotes, definition] });
		this.display();
	}

	private async removeQuickNote(id: string): Promise<void> {
		await this.patch({ quickNotes: this.plugin.settings.quickNotes.filter((definition) => definition.id !== id) });
		this.display();
	}

	private confirmRemoveQuickNote(definition: QuickNoteDefinition): void {
		new QuickNoteDeleteModal(this.app, {
			definition,
			onConfirm: async () => this.removeQuickNote(definition.id),
		}).open();
	}

	private async moveQuickNote(index: number, offset: -1 | 1): Promise<void> {
		const quickNotes = [...this.plugin.settings.quickNotes];
		const nextIndex = index + offset;
		const definition = quickNotes[index];
		if (!definition || nextIndex < 0 || nextIndex >= quickNotes.length) return;
		quickNotes.splice(index, 1);
		quickNotes.splice(nextIndex, 0, definition);
		await this.patch({ quickNotes });
		this.display();
	}

	private addFolderSetting(
		container: HTMLElement,
		name: string,
		description: string,
		key: 'diaryFolder' | 'projectLogFolder' | 'inboxFolder' | 'inspirationFolder',
	): void {
		const setting = new Setting(container).setName(name);
		const saveFolder = async (value: string): Promise<void> => {
			this.updateFolderDescription(setting, description, value);
			await this.patch({ [key]: value });
		};
		setting.addText((text) => {
				text.setPlaceholder('选择或输入知识库中已有目录')
					.setValue(this.plugin.settings[key])
					.onChange(saveFolder);
				new FolderSuggest(this.app, text.inputEl, (value) => void saveFolder(value));
			});
		this.updateFolderDescription(setting, description, this.plugin.settings[key]);
	}

	private updateFolderDescription(setting: Setting, description: string, value: string): void {
		const path = value.trim();
		if (!path) {
			setting.setDesc(`${description} 当前未配置。`);
			return;
		}
		const folder = this.app.vault.getAbstractFileByPath(normalizePath(path));
		setting.setDesc(folder instanceof TFolder ? `${description} 目录有效，已保存。` : `${description} 找不到此目录。`);
	}

	private updateTaskFileDescription(setting: Setting, value: string): void {
		const path = normalizePath(value.trim());
		if (!path.toLowerCase().endsWith('.md')) {
			setting.setDesc('任务文件必须是有效的 Markdown 文件路径。');
			return;
		}
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			setting.setDesc('任务文件有效；日历与日常待办会共用此文件。');
			return;
		}
		const separator = path.lastIndexOf('/');
		const parentPath = separator >= 0 ? path.slice(0, separator) : '';
		const parent = parentPath ? this.app.vault.getAbstractFileByPath(parentPath) : null;
		setting.setDesc(!parentPath || parent instanceof TFolder
			? '文件将在首次保存任务时创建；不会自动创建文件夹。'
			: '任务文件所在目录不存在。');
	}

	private addCropControls(
		container: HTMLElement,
		label: string,
		key: 'coverCrop' | 'avatarCrop' | 'galleryCrop',
	): void {
		const crop = this.plugin.settings[key];
		this.addCropSlider(container, `${label} · 缩放`, crop.zoom, 100, 200, 5, async (zoom) => {
			await this.patch({ [key]: { ...this.plugin.settings[key], zoom } });
		});
		this.addCropSlider(container, `${label} · 水平位置`, crop.x, 0, 100, 1, async (x) => {
			await this.patch({ [key]: { ...this.plugin.settings[key], x } });
		});
		this.addCropSlider(container, `${label} · 垂直位置`, crop.y, 0, 100, 1, async (y) => {
			await this.patch({ [key]: { ...this.plugin.settings[key], y } });
		});
	}

	private addCropSlider(
		container: HTMLElement,
		name: string,
		value: number,
		minimum: number,
		maximum: number,
		step: number,
		onChange: (value: number) => Promise<void>,
	): void {
		new Setting(container)
			.setName(name)
			.addSlider((slider) => slider
				.setLimits(minimum, maximum, step)
				.setDynamicTooltip()
				.setValue(value)
				.onChange(onChange));
	}

	private async patch(patch: Partial<AgentDashboardSettings>): Promise<void> {
		await this.plugin.updateSettings(normalizeSettings({ ...this.plugin.settings, ...patch }));
	}
}
