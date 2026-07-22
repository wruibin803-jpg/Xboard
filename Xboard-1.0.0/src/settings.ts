import { AbstractInputSuggest, App, normalizePath, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';
import type AgentDashboardPlugin from './main';
import { DEFAULT_CARD_ORDER, DEFAULT_CARD_SIZES } from './cards/registry';
import type { DashboardCardId, DashboardCardSize } from './cards/types';

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
	configVersion: 1;
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
	configVersion: 1,
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
	return {
		...DEFAULT_SETTINGS,
		configVersion: 1,
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
		diaryFolder: optionalText(raw.diaryFolder),
		projectLogFolder: optionalText(raw.projectLogFolder),
		inboxFolder: optionalText(raw.inboxFolder),
		inspirationFolder: optionalText(raw.inspirationFolder),
		taskFilePath: textValue(raw.taskFilePath, DEFAULT_SETTINGS.taskFilePath),
		openOnStartup: typeof raw.openOnStartup === 'boolean' ? raw.openOnStartup : DEFAULT_SETTINGS.openOnStartup,
		openWhenEmpty: typeof raw.openWhenEmpty === 'boolean' ? raw.openWhenEmpty : DEFAULT_SETTINGS.openWhenEmpty,
		pomodoroDate: typeof raw.pomodoroDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.pomodoroDate) ? raw.pomodoroDate : '',
		pomodoroRounds: Math.max(0, Math.floor(numberValue(raw.pomodoroRounds, 0))),
		cardOrder: order,
		cardSizes,
	};
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

		new Setting(containerEl).setName('知识库目录').setHeading();
		this.addFolderSetting(containerEl, '日记目录', '每篇新日记保存的位置。', 'diaryFolder');
		this.addFolderSetting(containerEl, '项目日志目录', '每篇新项目日志保存的位置。', 'projectLogFolder');
		this.addFolderSetting(containerEl, '收件箱目录', '临时笔记与待整理资料保存的位置；积压数量会递归统计其中的全部文件。', 'inboxFolder');
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
