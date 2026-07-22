import { ItemView, Notice, setIcon, TFile, WorkspaceLeaf } from 'obsidian';
import {
	DASHBOARD_ACTIONS,
	MOCK_AVATAR_SCENES,
	MOCK_BRIEF,
	MOCK_COVER_SCENES,
	MOCK_GITHUB_FEED,
	MOCK_STATS,
} from '../data/mockData';
import {
	type AgentDashboardSettings,
} from '../settings';
import { DEFAULT_CARD_ORDER, getCardDefinition } from '../cards/registry';
import type { DashboardCardId, DashboardCardSize } from '../cards/types';
import { CaptureModal } from '../modals/CaptureModal';
import { TaskModal } from '../modals/TaskModal';
import { VaultCheckModal } from '../modals/VaultCheckModal';
import {
	DashboardVaultService,
	type CaptureKind,
	type HeatmapData,
	type VaultCheckResult,
} from '../services/DashboardVaultService';
import {
	DashboardTaskService,
	type DashboardTask,
	type DashboardTaskInput,
	type DashboardTaskKind,
	type DashboardTaskPriority,
	type DashboardTaskScope,
} from '../services/DashboardTaskService';
import { DashboardActions } from '../services/DashboardActions';

const TASK_PRIORITY_LABELS: Record<DashboardTaskPriority, string> = {
	high: '高优先级',
	medium: '中优先级',
	low: '低优先级',
};

interface GalleryImage {
	name: string;
	alt: string;
	src: string;
	objectUrl?: string;
}

type TimerState = 'idle' | 'running' | 'paused';

export class AgentDashboardView extends ItemView {
	private rootEl: HTMLElement | null = null;
	private mainEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private greetingEl: HTMLElement | null = null;
	private inboxValueEl: HTMLElement | null = null;
	private inboxNoteEl: HTMLElement | null = null;
	private healthValueEl: HTMLElement | null = null;
	private healthNoteEl: HTMLElement | null = null;
	private healthProgressEl: HTMLElement | null = null;
	private taskFlowValueEl: HTMLElement | null = null;
	private taskFlowNoteEl: HTMLElement | null = null;
	private taskFlowProgressEl: HTMLElement | null = null;
	private heatmapGridEl: HTMLElement | null = null;
	private heatmapStatEl: HTMLElement | null = null;
	private layoutEditing = false;
	private draggedCardId: DashboardCardId | null = null;
	private coverIndex = 0;
	private avatarIndex = 0;
	private coverObjectUrl: string | null = null;
	private avatarObjectUrl: string | null = null;
	private galleryIndex = 0;
	private galleryImages: GalleryImage[] = MOCK_COVER_SCENES.map((scene) => ({
		name: scene.name,
		alt: scene.alt,
		src: this.svgToDataUrl(scene.svg),
	}));
	private taskState: DashboardTask[] = [];
	private tasksLoaded = false;
	private renderTasks: (() => void) | null = null;
	private renderCalendarView: (() => void) | null = null;
	private calendarViewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
	private selectedDate = new Date();
	private timerSeconds = 25 * 60;
	private timerTotalSeconds = 25 * 60;
	private timerRounds = 0;
	private timerState: TimerState = 'idle';
	private timerId: number | null = null;
	private timerEndAt: number | null = null;
	private statusTimerId: number | null = null;
	private timerCardEl: HTMLElement | null = null;
	private timerValueEl: HTMLElement | null = null;
	private timerRingEl: HTMLElement | null = null;
	private timerStartEl: HTMLButtonElement | null = null;
	private timerRoundsEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly viewType: string,
		private readonly getSettings: () => AgentDashboardSettings,
		private readonly updateSettings: (settings: AgentDashboardSettings) => Promise<void>,
		private readonly vaultService: DashboardVaultService,
		private readonly taskService: DashboardTaskService,
		private readonly actions: DashboardActions,
	) {
		super(leaf);
	}

	getViewType(): string {
		return this.viewType;
	}

	getDisplayText(): string {
		return 'Xboard';
	}

	getIcon(): string {
		return 'layout-dashboard';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('agent-dashboard-host');
		const dashboard = this.contentEl.createDiv({ cls: 'agent-dashboard-view' });
		this.rootEl = dashboard;
		this.applyDisplaySettings();

		this.renderCover(dashboard);
		this.renderHeader(dashboard);
		this.renderActions(dashboard);

		const main = dashboard.createEl('main', { cls: 'agent-dashboard-content' });
		this.mainEl = main;
		this.renderStats(main);
		this.renderCaptureCards(main);
		this.renderGallery(main);

		const insightGrid = main.createEl('section', {
			cls: 'agent-dashboard-insight-grid',
			attr: { 'aria-label': '知识库活跃度与日历' },
		});
		this.renderHeatmap(insightGrid);
		this.renderCalendar(insightGrid);

		const workGrid = main.createEl('section', {
			cls: 'agent-dashboard-work-grid',
			attr: { 'aria-label': '任务与专注计时' },
		});
		this.renderTaskBoard(workGrid);
		this.renderPomodoro(workGrid);
		this.renderGitHubFeed(main);
		this.flattenDashboardCards(main);
		this.renderFooter(dashboard);

		this.statusEl = dashboard.createDiv({
			cls: 'agent-dashboard-toast',
			attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
		});
		this.registerEvent(this.app.vault.on('create', (file) => {
			this.refreshVaultMetrics();
			if (file instanceof TFile && this.taskService.isTaskFile(file)) void this.refreshTaskData();
		}));
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && this.taskService.isTaskFile(file)) void this.refreshTaskData();
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			this.refreshVaultMetrics();
			if (this.taskService.isTaskPath(file.path)) void this.refreshTaskData();
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			this.refreshVaultMetrics();
			if (this.taskService.isTaskPath(oldPath) || (file instanceof TFile && this.taskService.isTaskFile(file))) {
				void this.refreshTaskData();
			}
		}));
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.refreshVaultMetrics()));
		await this.refreshTaskData();
	}

	async onClose(): Promise<void> {
		this.stopTimer();
		this.revokeObjectUrl(this.coverObjectUrl);
		this.revokeObjectUrl(this.avatarObjectUrl);
		for (const image of this.galleryImages) this.revokeObjectUrl(image.objectUrl ?? null);
		this.rootEl = null;
		this.mainEl = null;
		this.greetingEl = null;
		this.inboxValueEl = null;
		this.inboxNoteEl = null;
		this.healthValueEl = null;
		this.healthNoteEl = null;
		this.healthProgressEl = null;
		this.taskFlowValueEl = null;
		this.taskFlowNoteEl = null;
		this.taskFlowProgressEl = null;
		this.heatmapGridEl = null;
		this.heatmapStatEl = null;
		this.renderTasks = null;
		this.renderCalendarView = null;
		this.statusEl = null;
		const viewWindow = this.contentEl.ownerDocument.defaultView;
		if (this.statusTimerId !== null) viewWindow?.clearTimeout(this.statusTimerId);
		this.statusTimerId = null;
		this.contentEl.empty();
	}

	applyDisplaySettings(): void {
		if (!this.rootEl) return;
		const settings = this.getSettings();
		this.rootEl.dataset.theme = settings.theme;
		this.rootEl.dataset.size = settings.size;
		this.rootEl.dataset.density = settings.density;
		this.rootEl.dataset.coverMode = settings.coverMode;
		this.rootEl.style.setProperty('--ad-font-ui', this.cssFontValue(settings.fontFamily, 'sans-serif'));
		this.rootEl.style.setProperty('--ad-font-bubble', this.cssFontValue(settings.bubbleFontFamily, 'sans-serif'));
		this.rootEl.style.setProperty('--ad-bubble-size', `${settings.bubbleSize}px`);
		this.applyCropVariables('cover', settings.coverCrop.zoom, settings.coverCrop.x, settings.coverCrop.y);
		this.applyCropVariables('avatar', settings.avatarCrop.zoom, settings.avatarCrop.x, settings.avatarCrop.y);
		this.applyCropVariables('gallery', settings.galleryCrop.zoom, settings.galleryCrop.x, settings.galleryCrop.y);
		this.greetingEl?.setText(settings.greeting);
		const cover = this.rootEl.querySelector<HTMLElement>('.agent-dashboard-cover');
		cover?.classList.toggle('is-fade', settings.coverMode === 'fade');
		this.applyCardOrderAndSizes();
	}

	refreshVaultData(): void {
		this.refreshVaultMetrics();
	}

	async refreshTaskData(): Promise<void> {
		try {
			this.taskState = await this.taskService.readTasks();
			this.tasksLoaded = true;
			this.updateTaskMetrics();
			this.renderTasks?.();
			this.renderCalendarView?.();
		} catch (error) {
			this.tasksLoaded = false;
			this.taskFlowValueEl?.setText('0');
			this.taskFlowNoteEl?.setText('任务读取失败，请检查任务文件设置');
			this.setProgress(this.taskFlowProgressEl, 0);
			new Notice(error instanceof Error ? error.message : '读取 Xboard 待办失败。');
		}
	}

	async refreshDashboard(): Promise<void> {
		this.refreshVaultMetrics();
		await this.refreshTaskData();
	}

	private renderCover(container: HTMLElement): void {
		const cover = container.createEl('section', {
			cls: 'agent-dashboard-cover',
			attr: { 'aria-label': '知识库封面' },
		});
		cover.classList.toggle('is-fade', this.getSettings().coverMode === 'fade');
		const image = cover.createEl('img', { cls: 'agent-dashboard-cover-image' });
		const input = cover.createEl('input', {
			cls: 'agent-dashboard-file-input',
			attr: { type: 'file', accept: 'image/*', 'aria-label': '选择本地封面图片' },
		});
		const upload = cover.createEl('button', {
			cls: 'agent-dashboard-cover-upload',
			attr: { type: 'button', 'aria-label': '上传本地封面图片' },
		});
		setIcon(upload, 'camera');

		const updateImage = (): void => {
			if (this.coverObjectUrl) {
				image.setAttr('src', this.coverObjectUrl);
				image.setAttr('alt', '用户选择的顶部背景图片');
				return;
			}
			const scene = MOCK_COVER_SCENES[this.coverIndex]!;
			image.setAttr('src', this.svgToDataUrl(scene.svg));
			image.setAttr('alt', scene.alt);
		};

		this.registerDomEvent(upload, 'click', () => input.click());
		this.registerDomEvent(input, 'change', () => {
			const file = input.files?.[0];
			if (!file) return;
			this.revokeObjectUrl(this.coverObjectUrl);
			this.coverObjectUrl = this.createObjectUrl(file);
			updateImage();
			this.showMockStatus('顶部背景已在当前会话中更新');
		});
		this.registerDomEvent(image, 'dblclick', () => {
			if (this.coverObjectUrl) return;
			this.coverIndex = (this.coverIndex + 1) % MOCK_COVER_SCENES.length;
			updateImage();
		});
		updateImage();
	}

	private renderHeader(container: HTMLElement): void {
		const header = container.createEl('header', { cls: 'agent-dashboard-header' });
		const brand = header.createDiv({ cls: 'agent-dashboard-brand' });
		const avatarWrap = brand.createDiv({ cls: 'agent-dashboard-avatar-wrap' });
		const avatarButton = avatarWrap.createEl('button', {
			cls: 'agent-dashboard-avatar',
			attr: { type: 'button', 'aria-label': '切换头像' },
		});
		const avatarImage = avatarButton.createEl('img');
		const glyph = avatarButton.createSpan({ cls: 'agent-dashboard-avatar-glyph', text: '↻', attr: { 'aria-hidden': 'true' } });
		glyph.setAttr('title', '切换头像');
		const avatarInput = avatarWrap.createEl('input', {
			cls: 'agent-dashboard-file-input',
			attr: { type: 'file', accept: 'image/*', 'aria-label': '选择本地头像图片' },
		});
		const avatarUpload = avatarWrap.createEl('button', {
			cls: 'agent-dashboard-avatar-upload',
			attr: { type: 'button', 'aria-label': '上传本地头像' },
		});
		setIcon(avatarUpload, 'upload');

		const updateAvatar = (): void => {
			if (this.avatarObjectUrl) {
				avatarImage.setAttr('src', this.avatarObjectUrl);
				avatarImage.setAttr('alt', '用户选择的本地头像');
				return;
			}
			const avatar = MOCK_AVATAR_SCENES[this.avatarIndex]!;
			avatarImage.setAttr('src', this.svgToDataUrl(avatar.svg));
			avatarImage.setAttr('alt', avatar.alt);
		};

		this.registerDomEvent(avatarButton, 'click', () => {
			this.revokeObjectUrl(this.avatarObjectUrl);
			this.avatarObjectUrl = null;
			this.avatarIndex = (this.avatarIndex + 1) % MOCK_AVATAR_SCENES.length;
			updateAvatar();
			this.showMockStatus(`头像已切换为“${MOCK_AVATAR_SCENES[this.avatarIndex]!.name}”`);
		});
		this.registerDomEvent(avatarUpload, 'click', () => avatarInput.click());
		this.registerDomEvent(avatarInput, 'change', () => {
			const file = avatarInput.files?.[0];
			if (!file) return;
			this.revokeObjectUrl(this.avatarObjectUrl);
			this.avatarObjectUrl = this.createObjectUrl(file);
			updateAvatar();
			this.showMockStatus('头像已在当前会话中更新');
		});
		updateAvatar();

		const brandCopy = brand.createDiv();
		this.greetingEl = brandCopy.createEl('h1', { text: this.getSettings().greeting });

		const controls = header.createDiv({ cls: 'agent-dashboard-header-controls', attr: { 'aria-label': '本地数据状态' } });
		const live = controls.createSpan({ cls: 'agent-dashboard-live' });
		live.createSpan({ cls: 'agent-dashboard-live-dot', attr: { 'aria-hidden': 'true' } });
		live.createSpan({ text: '本地数据' });
		const syncTime = controls.createSpan({ cls: 'agent-dashboard-sync-time', text: '尚未手动刷新' });
		const refresh = this.createIconButton(controls, 'refresh-cw', '刷新仪表盘', 'agent-dashboard-refresh');
		refresh.createSpan({ text: '刷新' });
		this.registerDomEvent(refresh, 'click', () => {
			const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
			syncTime.setText(`上次刷新 ${time}`);
			void this.refreshDashboard();
			this.showMockStatus('知识库统计已刷新');
		});
		const layout = this.createIconButton(controls, 'move', '调整卡片布局');
		layout.setAttr('aria-pressed', 'false');
		this.registerDomEvent(layout, 'click', () => {
			this.layoutEditing = !this.layoutEditing;
			layout.setAttr('aria-pressed', String(this.layoutEditing));
			layout.setAttr('aria-label', this.layoutEditing ? '完成卡片布局调整' : '调整卡片布局');
			this.rootEl?.classList.toggle('is-layout-editing', this.layoutEditing);
			this.showMockStatus(this.layoutEditing ? '布局调整已开启：拖动卡片或使用卡片左上角按钮' : '布局调整已完成');
		});
		const settings = this.createIconButton(controls, 'settings-2', '打开 Xboard 设置');
		this.registerDomEvent(settings, 'click', () => {
			new Notice('请在设置 → 第三方插件中找到本插件，调整主题、字体、字号、欢迎语与图片裁剪。');
		});
	}

	private renderActions(container: HTMLElement): void {
		const rail = container.createEl('nav', { cls: 'agent-dashboard-actions', attr: { 'aria-label': '仪表盘快捷操作' } });
		for (const action of DASHBOARD_ACTIONS) {
			const captureKind: CaptureKind | null = action.id === 'diary' || action.id === 'project-log' || action.id === 'inbox'
				? action.id
				: null;
			const isVaultCheck = action.id === 'vault-check';
			const button = rail.createEl('button', {
				cls: 'agent-dashboard-action',
				text: action.comingSoon ? `${action.label} · 即将实现！` : action.label,
				attr: { type: 'button' },
			});
			if (action.comingSoon) button.addClass('is-coming-soon');
			this.registerDomEvent(button, 'click', () => {
				if (action.comingSoon) {
					this.showMockStatus(`${action.label}即将实现！`);
					return;
				}
				if (captureKind) {
					this.openCaptureModal(captureKind);
					return;
				}
				if (isVaultCheck) {
					this.openVaultCheck();
					return;
				}
			});
		}
	}

	private renderStats(container: HTMLElement): void {
		const health = this.vaultService.getVaultHealthSummary();
		const inbox = this.vaultService.getFolderSummary(this.getSettings().inboxFolder);
		const grid = container.createEl('section', { cls: 'agent-dashboard-metric-grid', attr: { 'aria-label': '知识库概览' } });
		for (const stat of MOCK_STATS) {
			const card = grid.createEl('article', { cls: `agent-dashboard-card agent-dashboard-metric agent-dashboard-metric--${stat.id}` });
			const heading = card.createDiv({ cls: 'agent-dashboard-metric-heading' });
			heading.createSpan({ text: stat.label });
			const icon = heading.createSpan({ cls: 'agent-dashboard-metric-icon', attr: { 'aria-hidden': 'true' } });
			setIcon(icon, stat.icon);
			const main = card.createDiv({ cls: 'agent-dashboard-metric-main' });
			const value = main.createEl('strong', {
				text: stat.id === 'health'
					? health.isEmpty ? '—' : String(health.healthScore)
					: stat.id === 'inbox'
					? inbox.status === 'ready' ? String(inbox.count) : '0'
					: stat.value,
			});
			main.createSpan({ text: stat.unit });
			const note = card.createEl('p', {
				cls: 'agent-dashboard-metric-note',
				text: stat.id === 'health'
					? health.isEmpty ? '还没有 Markdown 笔记' : this.formatHealthSummary(health.healthBreakdown.connectivity, health.healthBreakdown.linkIntegrity)
					: stat.id === 'inbox' ? this.inboxSummaryText(inbox.status, inbox.count) : stat.note,
			});
			if (stat.id === 'inbox') {
				this.inboxValueEl = value;
				this.inboxNoteEl = note;
			}
			if (stat.id === 'health') {
				this.healthValueEl = value;
				this.healthNoteEl = note;
			}
			if (stat.id === 'task-flow') {
				this.taskFlowValueEl = value;
				this.taskFlowNoteEl = note;
			}
			if (stat.id === 'inbox') {
				const bars = card.createDiv({ cls: 'agent-dashboard-queue-bars', attr: { 'aria-hidden': 'true' } });
				for (let index = 0; index < 7; index += 1) bars.createEl('i');
			} else {
				const track = card.createDiv({ cls: `agent-dashboard-progress${stat.id === 'task-flow' ? ' is-blue' : ''}`, attr: { 'aria-hidden': 'true' } });
				const progress = track.createSpan({ cls: stat.id === 'health' ? 'is-health-progress' : 'is-task-progress' });
				if (stat.id === 'health') {
					this.healthProgressEl = progress;
					this.updateHealthProgress(health.healthScore);
				}
				if (stat.id === 'task-flow') {
					this.taskFlowProgressEl = progress;
					this.updateTaskMetrics();
				}
			}
		}
	}

	private renderCaptureCards(container: HTMLElement): void {
		const grid = container.createEl('section', { cls: 'agent-dashboard-capture-grid', attr: { 'aria-label': '灵感与每日简报' } });
		const inspiration = grid.createEl('article', { cls: 'agent-dashboard-card agent-dashboard-inspiration' });
		this.renderSectionHeading(inspiration, '记录灵感');
		const input = inspiration.createEl('textarea', {
			attr: { rows: '3', maxlength: '240', placeholder: '现在想到什么？先记下来，稍后再整理。', 'aria-label': '输入一条灵感' },
		});
		const footer = inspiration.createDiv({ cls: 'agent-dashboard-capture-footer' });
		const count = footer.createSpan({ text: '0 / 240' });
		const save = footer.createEl('button', { cls: 'agent-dashboard-primary-button', text: '保存到灵感库', attr: { type: 'button' } });
		this.registerDomEvent(input, 'input', () => count.setText(`${input.value.length} / 240`));
		this.registerDomEvent(save, 'click', () => void this.saveInspiration(input, count, save));

		const brief = grid.createEl('article', { cls: 'agent-dashboard-card agent-dashboard-brief' });
		const briefHeading = this.renderSectionHeading(brief, '每日简报');
		briefHeading.createSpan({ cls: 'agent-dashboard-coming-soon', text: '即将实现！' });
		brief.createEl('p', { cls: 'agent-dashboard-preview-note', text: '以下为界面预览，暂不读取外部数据。' });
		const briefGrid = brief.createDiv({ cls: 'agent-dashboard-brief-grid' });
		for (const item of MOCK_BRIEF) {
			const row = briefGrid.createDiv({ cls: 'agent-dashboard-brief-item' });
			row.createSpan({ cls: `agent-dashboard-brief-index is-${item.tone}`, text: item.index });
			const copy = row.createDiv();
			copy.createEl('strong', { text: item.title });
			copy.createEl('p', { text: item.text });
		}
	}

	private renderGallery(container: HTMLElement): void {
		const card = container.createEl('article', { cls: 'agent-dashboard-card agent-dashboard-gallery', attr: { 'aria-label': '我的相框' } });
		const grid = card.createDiv({ cls: 'agent-dashboard-gallery-grid' });
		const frames: HTMLElement[] = [];
		const images: HTMLImageElement[] = [];
		for (let slot = 0; slot < 3; slot += 1) {
			const frame = grid.createDiv({ cls: `agent-dashboard-photo-frame is-slot-${slot + 1}` });
			frames.push(frame);
			images.push(frame.createEl('img'));
		}
		const previous = this.createIconButton(grid, 'chevron-left', '上一组照片', 'agent-dashboard-gallery-arrow is-previous');
		const next = this.createIconButton(grid, 'chevron-right', '下一组照片', 'agent-dashboard-gallery-arrow is-next');
		const actions = grid.createDiv({ cls: 'agent-dashboard-gallery-actions' });
		const add = this.createIconButton(actions, 'plus', '添加本地照片');
		const remove = this.createIconButton(actions, 'minus', '移除第一张照片');
		const input = actions.createEl('input', {
			cls: 'agent-dashboard-file-input',
			attr: { type: 'file', accept: 'image/*', multiple: '', 'aria-label': '选择相框照片' },
		});

		const update = (): void => {
			for (let slot = 0; slot < frames.length; slot += 1) {
				const frame = frames[slot]!;
				const image = images[slot]!;
				const current = slot < this.galleryImages.length
					? this.galleryImages[(this.galleryIndex + slot) % this.galleryImages.length]
					: undefined;
				if (!current) {
					image.removeAttribute('src');
					image.setAttr('alt', '相框中暂无照片');
					frame.addClass('is-empty');
					continue;
				}
				frame.removeClass('is-empty');
				image.setAttr('src', current.src);
				image.setAttr('alt', current.alt);
			}
		};
		this.registerDomEvent(previous, 'click', () => {
			if (!this.galleryImages.length) return;
			this.galleryIndex = (this.galleryIndex - 1 + this.galleryImages.length) % this.galleryImages.length;
			update();
		});
		this.registerDomEvent(next, 'click', () => {
			if (!this.galleryImages.length) return;
			this.galleryIndex = (this.galleryIndex + 1) % this.galleryImages.length;
			update();
		});
		this.registerDomEvent(add, 'click', () => input.click());
		this.registerDomEvent(input, 'change', () => {
			const files = Array.from(input.files ?? []);
			if (!files.length) return;
			for (const file of files) {
				const objectUrl = this.createObjectUrl(file);
				this.galleryImages.push({ name: file.name, alt: `相框照片：${file.name}`, src: objectUrl, objectUrl });
			}
			this.galleryIndex = this.galleryImages.length - files.length;
			input.value = '';
			update();
			this.showMockStatus(`已向相框添加 ${files.length} 张本地照片`);
		});
		this.registerDomEvent(remove, 'click', () => {
			const current = this.galleryImages[this.galleryIndex];
			if (!current) return;
			this.revokeObjectUrl(current.objectUrl ?? null);
			this.galleryImages.splice(this.galleryIndex, 1);
			this.galleryIndex = Math.max(0, Math.min(this.galleryIndex, this.galleryImages.length - 1));
			update();
			this.showMockStatus('当前照片已从相框移除');
		});
		update();
	}

	private renderHeatmap(container: HTMLElement): void {
		const heatmap = this.vaultService.getHeatmapData();
		const card = container.createEl('section', { cls: 'agent-dashboard-card agent-dashboard-heatmap', attr: { 'aria-label': '笔记热力图' } });
		const heading = this.renderSectionHeading(card, '笔记热力图');
		this.heatmapStatEl = heading.createEl('p', {
			cls: 'agent-dashboard-section-stat',
			text: `${heatmap.activeDays} 个活跃日，创建 ${heatmap.totalNotes} 篇，${heatmap.dateRange}`,
		});
		const viewport = card.createDiv({ cls: 'agent-dashboard-heatmap-viewport', attr: { tabindex: '0', 'aria-label': '可横向滚动的每日笔记活跃度热力图' } });
		const inner = viewport.createDiv({ cls: 'agent-dashboard-heatmap-inner' });
		const months = inner.createDiv({ cls: 'agent-dashboard-month-row', attr: { 'aria-hidden': 'true' } });
		Array.from({ length: 12 }, (_, index) => {
			const day = heatmap.days[Math.min(heatmap.days.length - 1, Math.floor(index * heatmap.days.length / 12))]!;
			return new Intl.DateTimeFormat('zh-CN', { month: 'short' }).format(day.date);
		}).forEach((month, index) => {
			months.createSpan({ cls: `is-month-${index + 1}`, text: month });
		});
		const body = inner.createDiv({ cls: 'agent-dashboard-heatmap-body' });
		const weekdays = body.createDiv({ cls: 'agent-dashboard-weekdays', attr: { 'aria-hidden': 'true' } });
		for (const day of ['周一', '', '周三', '', '周五', '', '']) weekdays.createSpan({ text: day });
		const grid = body.createDiv({ cls: 'agent-dashboard-heatmap-grid', attr: { role: 'img', 'aria-label': `近一年创建了 ${heatmap.totalNotes} 篇笔记` } });
		this.heatmapGridEl = grid;
		this.renderHeatmapCells(grid, heatmap);
		const footer = card.createDiv({ cls: 'agent-dashboard-heatmap-footer' });
		footer.createSpan({ text: '每格代表一天' });
		const legend = footer.createDiv({ cls: 'agent-dashboard-legend', attr: { 'aria-label': '热力图强度图例' } });
		legend.createSpan({ text: '少' });
		for (let level = 0; level <= 4; level += 1) legend.createEl('i', { cls: `agent-dashboard-heatmap-cell level-${level}` });
		legend.createSpan({ text: '多' });
	}

	private renderHeatmapCells(grid: HTMLElement, heatmap: HeatmapData): void {
		const leadingDays = (heatmap.days[0]!.date.getDay() + 6) % 7;
		for (let blank = 0; blank < leadingDays; blank += 1) grid.createSpan({ cls: 'agent-dashboard-heatmap-cell is-empty', attr: { 'aria-hidden': 'true' } });
		const formatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
		for (const day of heatmap.days) {
			grid.createSpan({ cls: `agent-dashboard-heatmap-cell level-${day.level}`, attr: { 'aria-hidden': 'true', title: `${formatter.format(day.date)}：${day.count} 篇笔记` } });
		}
	}

	private renderCalendar(container: HTMLElement): void {
		const card = container.createEl('section', { cls: 'agent-dashboard-card agent-dashboard-calendar', attr: { 'aria-label': '日历' } });
		const heading = this.renderSectionHeading(card, '日历');
		const controls = heading.createDiv({ cls: 'agent-dashboard-calendar-controls' });
		const previous = this.createIconButton(controls, 'chevron-left', '上个月');
		const today = controls.createEl('button', { text: '今天', attr: { type: 'button' } });
		const next = this.createIconButton(controls, 'chevron-right', '下个月');
		const add = this.createIconButton(controls, 'plus', '为所选日期新建待办或 DDL');
		const monthLabel = card.createDiv({ cls: 'agent-dashboard-calendar-month', attr: { 'aria-live': 'polite' } });
		const weekdays = card.createDiv({ cls: 'agent-dashboard-calendar-weekdays', attr: { 'aria-hidden': 'true' } });
		for (const day of ['一', '二', '三', '四', '五', '六', '日']) weekdays.createSpan({ text: day });
		const grid = card.createDiv({ cls: 'agent-dashboard-calendar-grid', attr: { role: 'grid', 'aria-label': '月历' } });
		const summary = card.createDiv({ cls: 'agent-dashboard-calendar-summary' });
		const selectedLabel = summary.createEl('strong');
		const eventLabel = summary.createSpan();
		const renderMonth = (): void => this.renderCalendarMonth(grid, monthLabel, selectedLabel, eventLabel, renderMonth);
		this.renderCalendarView = renderMonth;
		this.registerDomEvent(previous, 'click', () => {
			this.calendarViewDate = new Date(this.calendarViewDate.getFullYear(), this.calendarViewDate.getMonth() - 1, 1);
			renderMonth();
		});
		this.registerDomEvent(next, 'click', () => {
			this.calendarViewDate = new Date(this.calendarViewDate.getFullYear(), this.calendarViewDate.getMonth() + 1, 1);
			renderMonth();
		});
		this.registerDomEvent(today, 'click', () => {
			this.selectedDate = new Date();
			this.calendarViewDate = new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), 1);
			renderMonth();
		});
		this.registerDomEvent(add, 'click', () => this.openTaskModal(this.selectedDate));
		renderMonth();
	}

	private renderCalendarMonth(
		grid: HTMLElement,
		monthLabel: HTMLElement,
		selectedLabel: HTMLElement,
		eventLabel: HTMLElement,
		renderMonth: () => void,
	): void {
		const year = this.calendarViewDate.getFullYear();
		const month = this.calendarViewDate.getMonth();
		const firstDay = new Date(year, month, 1);
		const gridStart = new Date(year, month, 1 - ((firstDay.getDay() + 6) % 7));
		const today = new Date();
		const monthFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' });
		const dateFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
		monthLabel.setText(monthFormatter.format(firstDay));
		grid.empty();
		for (let index = 0; index < 42; index += 1) {
			const date = new Date(gridStart);
			date.setDate(gridStart.getDate() + index);
			const tasks = this.getCalendarTasks(date);
			const count = tasks.length;
			const button = grid.createEl('button', {
				cls: 'agent-dashboard-calendar-day',
				text: String(date.getDate()),
				attr: { type: 'button', role: 'gridcell', 'aria-label': `${dateFormatter.format(date)}，${count} 项安排` },
			});
			if (date.getMonth() !== month) button.addClass('is-outside');
			if (this.isSameDate(date, today)) button.addClass('is-today');
			if (this.isSameDate(date, this.selectedDate)) button.addClass('is-selected');
			if (count > 0) button.addClass('has-tasks');
			const urgency = this.getDeadlineUrgency(tasks, today);
			if (urgency) {
				button.addClass(`is-deadline-${urgency}`);
				const urgencyLabel = urgency === 'red' ? '临近或逾期' : urgency === 'yellow' ? '即将到期' : '时间充足';
				button.setAttr('aria-label', `${dateFormatter.format(date)}，${count} 项安排，DDL ${urgencyLabel}`);
			}
			button.addEventListener('click', () => {
				this.selectedDate = new Date(date);
				if (date.getMonth() !== month) this.calendarViewDate = new Date(date.getFullYear(), date.getMonth(), 1);
				renderMonth();
			});
			button.addEventListener('dblclick', () => this.openTaskModal(date));
		}
		const count = this.getCalendarTasks(this.selectedDate).length;
		selectedLabel.setText(dateFormatter.format(this.selectedDate));
		eventLabel.setText(count > 0 ? `${count} 项安排` : '暂无安排');
	}

	private renderTaskBoard(container: HTMLElement): void {
		const card = container.createEl('article', { cls: 'agent-dashboard-card agent-dashboard-tasks' });
		const heading = this.renderSectionHeading(card, '日常待办');
		const headingActions = heading.createDiv({ cls: 'agent-dashboard-task-heading-actions' });
		const total = headingActions.createSpan({ cls: 'agent-dashboard-item-count' });
		const add = headingActions.createEl('button', { cls: 'agent-dashboard-quiet-button', text: '＋ 添加任务', attr: { type: 'button', 'aria-expanded': 'false' } });
		const form = card.createEl('form', { cls: 'agent-dashboard-task-form' });
		form.hidden = true;
		const title = this.createField(form, '任务标题', 'text', '例如：整理今天的项目记录', 'agent-dashboard-field-wide');
		const scopeField = form.createEl('label', { cls: 'agent-dashboard-form-field' });
		scopeField.createSpan({ text: '任务周期' });
		const scope = scopeField.createEl('select');
		scope.createEl('option', { value: 'daily', text: '每日任务' });
		scope.createEl('option', { value: 'weekly', text: '每周任务' });
		const kindField = form.createEl('label', { cls: 'agent-dashboard-form-field' });
		kindField.createSpan({ text: '类型' });
		const kind = kindField.createEl('select');
		kind.createEl('option', { value: 'todo', text: '待办' });
		kind.createEl('option', { value: 'ddl', text: 'DDL' });
		const due = this.createField(form, '日期', 'date', '', '');
		due.value = this.currentDateKey();
		const priorityField = form.createEl('label', { cls: 'agent-dashboard-form-field' });
		priorityField.createSpan({ text: '优先级' });
		const priority = priorityField.createEl('select');
		priority.createEl('option', { value: 'high', text: '高' });
		priority.createEl('option', { value: 'medium', text: '中' });
		priority.createEl('option', { value: 'low', text: '低' });
		priority.value = 'medium';
		const note = this.createField(form, '备注', 'text', '补充上下文或完成标准', 'agent-dashboard-field-wide');
		const formActions = form.createDiv({ cls: 'agent-dashboard-form-actions' });
		const cancel = formActions.createEl('button', { cls: 'agent-dashboard-quiet-button', text: '取消', attr: { type: 'button' } });
		formActions.createEl('button', { cls: 'agent-dashboard-primary-button', text: '保存任务', attr: { type: 'submit' } });
		const board = card.createDiv({ cls: 'agent-dashboard-task-board' });
		const dailyList = this.createTaskGroup(board, '每日任务');
		const weeklyList = this.createTaskGroup(board, '每周任务');
		const setFormVisible = (visible: boolean): void => {
			form.hidden = !visible;
			add.setAttr('aria-expanded', String(visible));
			if (visible) title.focus();
		};
		const render = (): void => {
			this.renderTaskGroup(dailyList.list, dailyList.count, 'daily', render);
			this.renderTaskGroup(weeklyList.list, weeklyList.count, 'weekly', render);
			total.setText(`${String(this.taskState.length).padStart(2, '0')} 项`);
		};
		this.renderTasks = render;
		this.registerDomEvent(add, 'click', () => setFormVisible(form.hidden));
		this.registerDomEvent(cancel, 'click', () => {
			form.reset();
			setFormVisible(false);
		});
		this.registerDomEvent(form, 'submit', (event) => {
			event.preventDefault();
			const taskTitle = title.value.trim();
			if (!taskTitle) {
				title.focus();
				return;
			}
			const taskScope: DashboardTaskScope = scope.value === 'weekly' ? 'weekly' : 'daily';
			const taskKind: DashboardTaskKind = kind.value === 'ddl' ? 'ddl' : 'todo';
			const taskPriority = this.toTaskPriority(priority.value);
			const input: DashboardTaskInput = {
				title: taskTitle,
				note: note.value.trim(),
				dueDate: due.value || this.currentDateKey(),
				scope: taskScope,
				kind: taskKind,
				priority: taskPriority,
			};
			void this.addDashboardTask(input, () => {
				form.reset();
				due.value = this.currentDateKey();
				priority.value = 'medium';
				setFormVisible(false);
			}, `已添加${taskScope === 'daily' ? '每日' : '每周'}任务`);
		});
		render();
	}

	private createTaskGroup(container: HTMLElement, title: string): { list: HTMLElement; count: HTMLElement } {
		const panel = container.createEl('section', { cls: 'agent-dashboard-task-scope' });
		const heading = panel.createDiv({ cls: 'agent-dashboard-task-scope-heading' });
		heading.createEl('h3', { text: title });
		const count = heading.createSpan();
		const list = panel.createEl('ul', { cls: 'agent-dashboard-task-list' });
		return { list, count };
	}

	private renderTaskGroup(list: HTMLElement, count: HTMLElement, scope: DashboardTaskScope, rerender: () => void): void {
		const tasks = this.taskState.filter((task) => task.scope === scope);
		list.empty();
		count.setText(String(tasks.length).padStart(2, '0'));
		if (!tasks.length) {
			list.createEl('li', { cls: 'agent-dashboard-empty-task', text: '这一组暂时没有任务' });
			return;
		}
		for (const [index, task] of tasks.entries()) {
			const item = list.createEl('li', { cls: `agent-dashboard-task-item${task.completed ? ' is-done' : ''}` });
			item.dataset.taskPriority = task.priority;
			item.dataset.taskRank = String(Math.min(5, index + 1));
			const toggle = item.createEl('button', { cls: 'agent-dashboard-task-toggle', attr: { type: 'button', 'aria-label': `切换任务状态：${task.title}` } });
			if (task.completed) setIcon(toggle, 'check');
			const copy = item.createDiv({ cls: 'agent-dashboard-task-copy' });
			copy.createSpan({ cls: 'agent-dashboard-task-title', text: task.title });
			if (task.note) copy.createSpan({ cls: 'agent-dashboard-task-note', text: task.note });
			const meta = copy.createDiv({ cls: 'agent-dashboard-task-meta' });
			meta.createSpan({ cls: `is-priority-${task.priority}`, text: TASK_PRIORITY_LABELS[task.priority] });
			meta.createSpan({ text: task.dueDate });
			meta.createSpan({ cls: task.completed ? 'is-done' : task.kind === 'ddl' ? 'is-doing' : 'is-todo', text: task.completed ? '已完成' : task.kind === 'ddl' ? 'DDL' : '待办' });
			const actions = item.createDiv({ cls: 'agent-dashboard-task-item-actions' });
			const pin = this.createIconButton(actions, 'pin', `置顶任务：${task.title}`);
			const up = this.createIconButton(actions, 'chevron-up', `上移任务：${task.title}`);
			const down = this.createIconButton(actions, 'chevron-down', `下移任务：${task.title}`);
			const remove = this.createIconButton(actions, 'trash-2', `删除任务：${task.title}`, 'agent-dashboard-task-delete');
			pin.disabled = index === 0;
			up.disabled = index === 0;
			down.disabled = index === tasks.length - 1;
			toggle.addEventListener('click', () => {
				void this.runTaskMutation(() => this.actions.setTaskCompleted(task.id, !task.completed), rerender);
			});
			pin.addEventListener('click', () => void this.runTaskMutation(() => this.actions.moveTask(task.id, 'top'), rerender));
			up.addEventListener('click', () => void this.runTaskMutation(() => this.actions.moveTask(task.id, 'up'), rerender));
			down.addEventListener('click', () => void this.runTaskMutation(() => this.actions.moveTask(task.id, 'down'), rerender));
			remove.addEventListener('click', () => {
				void this.runTaskMutation(() => this.actions.deleteTask(task.id), rerender, '任务已删除');
			});
		}
	}

	private renderPomodoro(container: HTMLElement): void {
		const card = container.createEl('article', { cls: 'agent-dashboard-card agent-dashboard-pomodoro' });
		this.timerCardEl = card;
		const settings = this.getSettings();
		this.timerRounds = settings.pomodoroDate === this.currentDateKey() ? settings.pomodoroRounds : 0;
		const heading = this.renderSectionHeading(card, '番茄钟');
		this.timerRoundsEl = heading.createSpan({ cls: 'agent-dashboard-soft-badge', text: `今日 ${this.timerRounds} 轮` });
		const modes = card.createDiv({ cls: 'agent-dashboard-segmented', attr: { role: 'tablist', 'aria-label': '番茄钟模式' } });
		const focus = modes.createEl('button', { cls: 'is-active', text: '专注', attr: { type: 'button', role: 'tab', 'aria-selected': 'true' } });
		const breakButton = modes.createEl('button', { text: '短休息', attr: { type: 'button', role: 'tab', 'aria-selected': 'false' } });
		this.timerRingEl = card.createDiv({ cls: 'agent-dashboard-timer-ring', attr: { 'aria-label': '番茄钟未开始，剩余 25 分 0 秒' } });
		const timerCopy = this.timerRingEl.createDiv();
		this.timerValueEl = timerCopy.createEl('strong', { text: '25:00' });
		const actions = card.createDiv({ cls: 'agent-dashboard-timer-actions' });
		this.timerStartEl = actions.createEl('button', { cls: 'agent-dashboard-primary-button', text: '开始专注', attr: { type: 'button' } });
		const reset = this.createIconButton(actions, 'rotate-ccw', '重置番茄钟');
		const selectMode = (minutes: number, active: HTMLButtonElement): void => {
			this.stopTimer('idle');
			this.timerTotalSeconds = minutes * 60;
			this.timerSeconds = this.timerTotalSeconds;
			for (const button of [focus, breakButton]) {
				const isActive = button === active;
				button.classList.toggle('is-active', isActive);
				button.setAttr('aria-selected', String(isActive));
			}
			this.updateTimer();
		};
		this.registerDomEvent(focus, 'click', () => selectMode(25, focus));
		this.registerDomEvent(breakButton, 'click', () => selectMode(5, breakButton));
		this.registerDomEvent(this.timerStartEl, 'click', () => this.toggleTimer());
		this.registerDomEvent(reset, 'click', () => {
			this.stopTimer('idle');
			this.timerSeconds = this.timerTotalSeconds;
			this.updateTimer();
		});
		this.updateTimer();
	}

	private renderGitHubFeed(container: HTMLElement): void {
		const card = container.createEl('article', { cls: 'agent-dashboard-card agent-dashboard-github' });
		const heading = this.renderSectionHeading(card, 'GitHub 动态');
		heading.createSpan({ cls: 'agent-dashboard-coming-soon', text: '即将实现！' });
		card.createEl('p', { cls: 'agent-dashboard-preview-note', text: '以下为界面预览，暂不连接 GitHub。' });
		const list = card.createEl('ul', { cls: 'agent-dashboard-github-list' });
		for (const entry of MOCK_GITHUB_FEED) {
			const item = list.createEl('li');
			item.createSpan({ cls: 'agent-dashboard-repo-glyph', text: (entry.repo.split('/')[1] ?? entry.repo).slice(0, 2).toUpperCase(), attr: { 'aria-hidden': 'true' } });
			const copy = item.createDiv({ cls: 'agent-dashboard-repo-copy' });
			copy.createSpan({ cls: 'agent-dashboard-repo-name', text: entry.repo });
			copy.createSpan({ cls: 'agent-dashboard-repo-description', text: entry.description });
			const meta = copy.createSpan({ cls: 'agent-dashboard-repo-meta' });
			meta.createSpan({ cls: 'agent-dashboard-stars', text: `★ ${entry.stars}` });
			meta.createSpan({ text: entry.updated });
		}
	}

	private flattenDashboardCards(main: HTMLElement): void {
		const cards = new Map<DashboardCardId, HTMLElement>();
		for (const id of DEFAULT_CARD_ORDER) {
			const card = main.querySelector<HTMLElement>(getCardDefinition(id).selector);
			if (card) cards.set(id, card);
		}

		main.empty();
		for (const id of DEFAULT_CARD_ORDER) {
			const card = cards.get(id);
			if (!card) continue;
			card.dataset.cardId = id;
			card.addClass('agent-dashboard-layout-card');
			this.addCardLayoutControls(card, id);
			main.appendChild(card);
		}
		this.applyCardOrderAndSizes();
	}

	private addCardLayoutControls(card: HTMLElement, id: DashboardCardId): void {
		const controls = card.createDiv({ cls: 'agent-dashboard-card-layout-controls', attr: { 'aria-label': '卡片布局控制' } });
		const handle = this.createIconButton(controls, 'grip-vertical', `拖动“${this.cardLabel(id)}”卡片`, 'agent-dashboard-card-drag');
		handle.setAttr('draggable', 'true');
		const previous = this.createIconButton(controls, 'arrow-left', '向前移动卡片');
		const next = this.createIconButton(controls, 'arrow-right', '向后移动卡片');
		const size = controls.createEl('button', { cls: 'agent-dashboard-card-size', attr: { type: 'button' } });

		const updateSizeText = (): void => {
			const current = this.getSettings().cardSizes[id];
			size.setText(this.cardSizeLabel(current));
			size.setAttr('aria-label', `${this.cardLabel(id)}当前为${this.cardSizeLabel(current)}，点击切换尺寸`);
		};

		this.registerDomEvent(previous, 'click', () => this.runAsync(() => this.moveCard(id, -1), '保存卡片顺序失败。'));
		this.registerDomEvent(next, 'click', () => this.runAsync(() => this.moveCard(id, 1), '保存卡片顺序失败。'));
		this.registerDomEvent(size, 'click', () => {
			this.runAsync(async () => {
				await this.cycleCardSize(id);
				updateSizeText();
			}, '保存卡片尺寸失败。');
		});
		this.registerDomEvent(handle, 'dragstart', (event) => {
			if (!this.layoutEditing) {
				event.preventDefault();
				return;
			}
			this.draggedCardId = id;
			card.addClass('is-dragging');
			event.dataTransfer?.setData('text/plain', id);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
		});
		this.registerDomEvent(handle, 'dragend', () => {
			this.draggedCardId = null;
			card.removeClass('is-dragging');
		});
		this.registerDomEvent(card, 'dragover', (event) => {
			if (!this.layoutEditing || !this.draggedCardId || this.draggedCardId === id) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		});
		this.registerDomEvent(card, 'drop', (event) => {
			if (!this.layoutEditing || !this.draggedCardId || this.draggedCardId === id) return;
			event.preventDefault();
			this.runAsync(() => this.dropCardBefore(this.draggedCardId!, id), '保存卡片顺序失败。');
		});
		updateSizeText();
	}

	private applyCardOrderAndSizes(): void {
		if (!this.mainEl) return;
		const settings = this.getSettings();
		const cards = new Map<DashboardCardId, HTMLElement>();
		for (const child of Array.from(this.mainEl.children)) {
			if (!child.instanceOf(HTMLElement)) continue;
			const id = this.toCardId(child.dataset.cardId);
			if (id) cards.set(id, child);
		}
		for (const id of settings.cardOrder) {
			const card = cards.get(id);
			if (!card) continue;
			card.dataset.cardSize = settings.cardSizes[id];
			const sizeButton = card.querySelector<HTMLButtonElement>('.agent-dashboard-card-size');
			sizeButton?.setText(this.cardSizeLabel(settings.cardSizes[id]));
			this.mainEl.appendChild(card);
		}
	}

	private async moveCard(id: DashboardCardId, direction: -1 | 1): Promise<void> {
		const settings = this.getSettings();
		const order = [...settings.cardOrder];
		const index = order.indexOf(id);
		const target = index + direction;
		if (index < 0 || target < 0 || target >= order.length) return;
		[order[index], order[target]] = [order[target]!, order[index]!];
		await this.updateSettings({ ...settings, cardOrder: order });
	}

	private async dropCardBefore(source: DashboardCardId, target: DashboardCardId): Promise<void> {
		const settings = this.getSettings();
		const order = settings.cardOrder.filter((id) => id !== source);
		const targetIndex = order.indexOf(target);
		order.splice(Math.max(0, targetIndex), 0, source);
		this.draggedCardId = null;
		await this.updateSettings({ ...settings, cardOrder: order });
	}

	private async cycleCardSize(id: DashboardCardId): Promise<void> {
		const settings = this.getSettings();
		const sizes: DashboardCardSize[] = ['compact', 'standard', 'wide'];
		const current = settings.cardSizes[id];
		const next = sizes[(sizes.indexOf(current) + 1) % sizes.length]!;
		await this.updateSettings({
			...settings,
			cardSizes: { ...settings.cardSizes, [id]: next },
		});
	}

	private runAsync(operation: () => Promise<void>, fallback: string): void {
		void operation().catch((error: unknown) => {
			new Notice(error instanceof Error ? error.message : fallback);
		});
	}

	private cardSizeLabel(size: DashboardCardSize): string {
		if (size === 'compact') return '紧凑 1×1';
		if (size === 'standard') return '标准 1×2';
		return '加宽 1×3';
	}

	private cardLabel(id: DashboardCardId): string {
		return getCardDefinition(id).title;
	}

	private toCardId(value: string | undefined): DashboardCardId | null {
		return value && DEFAULT_CARD_ORDER.includes(value as DashboardCardId) ? value as DashboardCardId : null;
	}

	private openTaskModal(date: Date): void {
		new TaskModal(this.app, {
			date: this.dateKey(date),
			onSubmit: async (input) => {
				await this.actions.createTask(input);
				await this.refreshTaskData();
				this.showMockStatus(input.kind === 'ddl' ? 'DDL 已添加到日历与每日任务' : '待办已添加到日历与每日任务');
			},
		}).open();
	}

	private async runTaskMutation(
		operation: () => Promise<void>,
		rerender: () => void,
		message?: string,
	): Promise<void> {
		try {
			await operation();
			this.taskState = await this.taskService.readTasks();
			this.tasksLoaded = true;
			this.updateTaskMetrics();
			rerender();
			this.renderCalendarView?.();
			if (message) this.showMockStatus(message);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '更新任务失败。');
		}
	}

	private async addDashboardTask(input: DashboardTaskInput, onSaved: () => void, message: string): Promise<void> {
		try {
			await this.actions.createTask(input);
			onSaved();
			await this.refreshTaskData();
			this.showMockStatus(message);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存任务失败。');
		}
	}

	private toTaskPriority(value: string): DashboardTaskPriority {
		if (value === 'high' || value === 'low') return value;
		return 'medium';
	}

	private openCaptureModal(kind: CaptureKind): void {
		new CaptureModal(this.app, {
			kind,
			onSubmit: async (input) => {
				const file = await this.actions.createCapture(input);
				this.refreshVaultMetrics();
				new Notice(`已创建 ${file.path}`);
				this.showMockStatus('新笔记已创建并打开');
			},
		}).open();
	}

	private openVaultCheck(): void {
		new VaultCheckModal(this.app, {
			service: this.vaultService,
			onComplete: (result) => this.applyVaultCheckResult(result),
			onOpenFile: (path) => this.actions.openFile(path),
		}).open();
	}

	private applyVaultCheckResult(result: VaultCheckResult): void {
		this.healthValueEl?.setText(result.totalNotes === 0 ? '—' : String(result.healthScore));
		this.updateHealthProgress(result.healthScore);
		this.healthNoteEl?.setText(result.totalNotes === 0
			? '还没有 Markdown 笔记'
			: this.formatHealthSummary(result.healthBreakdown.connectivity, result.healthBreakdown.linkIntegrity));
		this.showMockStatus('知识库检查已完成');
	}

	private async saveInspiration(
		input: HTMLTextAreaElement,
		count: HTMLElement,
		button: HTMLButtonElement,
	): Promise<void> {
		const content = input.value.trim();
		if (!content) {
			this.showMockStatus('请先写下一条灵感');
			input.focus();
			return;
		}
		button.disabled = true;
		button.setText('正在保存…');
		try {
			const file = await this.actions.saveInspiration(content);
			input.value = '';
			count.setText('0 / 240');
			new Notice(`灵感已保存到 ${file.path}`);
			this.showMockStatus('灵感已保存到灵感库');
			this.refreshVaultMetrics();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存灵感失败。');
		} finally {
			button.disabled = false;
			button.setText('保存到灵感库');
		}
	}

	private refreshVaultMetrics(): void {
		if (!this.rootEl) return;
		const health = this.vaultService.getVaultHealthSummary();
		this.healthValueEl?.setText(health.isEmpty ? '—' : String(health.healthScore));
		this.updateHealthProgress(health.healthScore);
		this.healthNoteEl?.setText(health.isEmpty
			? '还没有 Markdown 笔记'
			: this.formatHealthSummary(health.healthBreakdown.connectivity, health.healthBreakdown.linkIntegrity));
		const inbox = this.vaultService.getFolderSummary(this.getSettings().inboxFolder);
		this.inboxValueEl?.setText(inbox.status === 'ready' ? String(inbox.count) : '0');
		this.inboxNoteEl?.setText(this.inboxSummaryText(inbox.status, inbox.count));
		const heatmap = this.vaultService.getHeatmapData();
		if (this.heatmapGridEl) {
			this.heatmapGridEl.empty();
			this.heatmapGridEl.setAttr('aria-label', `近一年创建了 ${heatmap.totalNotes} 篇笔记`);
			this.renderHeatmapCells(this.heatmapGridEl, heatmap);
		}
		this.heatmapStatEl?.setText(`${heatmap.activeDays} 个活跃日，创建 ${heatmap.totalNotes} 篇，${heatmap.dateRange}`);
	}

	private formatHealthSummary(connectivity: number, linkIntegrity: number): string {
		return `连接性 ${connectivity}% · 链接完整 ${linkIntegrity}%`;
	}

	private updateHealthProgress(score: number): void {
		this.setProgress(this.healthProgressEl, score);
		this.healthNoteEl?.classList.toggle('is-positive', score >= 80);
	}

	private updateTaskMetrics(): void {
		if (!this.taskFlowValueEl || !this.taskFlowNoteEl) return;
		if (!this.tasksLoaded) {
			this.taskFlowValueEl.setText('0');
			this.taskFlowNoteEl.setText('正在读取真实任务');
			this.setProgress(this.taskFlowProgressEl, 0);
			return;
		}
		const total = this.taskState.length;
		if (total === 0) {
			this.taskFlowValueEl.setText('0');
			this.taskFlowNoteEl.setText('还没有任务，可以从任务卡片添加');
			this.setProgress(this.taskFlowProgressEl, 0);
			return;
		}
		const completed = this.taskState.filter((task) => task.completed).length;
		const today = this.currentDateKey();
		const overdue = this.taskState.filter((task) => !task.completed && task.dueDate < today).length;
		const progress = Math.round((completed / total) * 100);
		this.taskFlowValueEl.setText(`${progress}%`);
		this.taskFlowNoteEl.setText(`已完成 ${completed}/${total}${overdue > 0 ? ` · ${overdue} 项逾期` : ''}`);
		this.setProgress(this.taskFlowProgressEl, progress);
	}

	private inboxSummaryText(status: 'unconfigured' | 'missing' | 'ready', count: number): string {
		if (status === 'unconfigured') return '请先在设置中选择收件箱目录';
		if (status === 'missing') return '收件箱目录不存在，请检查设置';
		return count > 0 ? `${count} 个文件等待整理` : '收件箱已清空';
	}

	private setProgress(element: HTMLElement | null, score: number): void {
		if (element) element.dataset.progress = String(Math.round(Math.max(0, Math.min(100, score)) / 10));
	}

	private applyCropVariables(target: 'cover' | 'avatar' | 'gallery', zoom: number, x: number, y: number): void {
		if (!this.rootEl) return;
		this.rootEl.style.setProperty(`--ad-${target}-scale`, String(zoom / 100));
		this.rootEl.style.setProperty(`--ad-${target}-x`, `${x}%`);
		this.rootEl.style.setProperty(`--ad-${target}-y`, `${y}%`);
	}

	private cssFontValue(font: string, fallback: string): string {
		const safeFont = font.replace(/["\\]/g, '');
		return `"${safeFont}", "Noto Sans SC", "Microsoft YaHei UI", ${fallback}`;
	}

	private renderFooter(container: HTMLElement): void {
		const footer = container.createEl('footer', { cls: 'agent-dashboard-footer' });
		footer.createSpan({ text: 'Xboard 1.0 / 智能体知识工作台' });
		footer.createSpan({ text: '本地优先 · 数据留在你的知识库' });
	}

	private renderSectionHeading(container: HTMLElement, title: string): HTMLElement {
		const heading = container.createDiv({ cls: 'agent-dashboard-section-heading' });
		heading.createEl('h2', { text: title });
		return heading;
	}

	private createIconButton(container: HTMLElement, icon: string, label: string, extraClass = ''): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: `agent-dashboard-icon-button ${extraClass}`.trim(),
			attr: { type: 'button', 'aria-label': label, title: label },
		});
		setIcon(button, icon);
		return button;
	}

	private createField(container: HTMLElement, label: string, type: string, placeholder: string, extraClass = ''): HTMLInputElement {
		const field = container.createEl('label', { cls: `agent-dashboard-form-field ${extraClass}`.trim() });
		field.createSpan({ text: label });
		return field.createEl('input', { attr: { type, placeholder, maxlength: '120' } });
	}

	private toggleTimer(): void {
		if (this.timerId !== null) {
			this.updateTimerFromClock();
			this.stopTimer('paused');
			this.updateTimer();
			return;
		}
		const viewWindow = this.contentEl.ownerDocument.defaultView;
		if (!viewWindow) return;
		this.timerState = 'running';
		this.timerEndAt = Date.now() + this.timerSeconds * 1000;
		this.timerId = viewWindow.setInterval(() => {
			this.updateTimerFromClock();
			if (this.timerSeconds <= 0) {
				const completedFocus = this.timerTotalSeconds === 25 * 60;
				this.stopTimer('idle');
				if (completedFocus) {
					if (this.getSettings().pomodoroDate !== this.currentDateKey()) this.timerRounds = 0;
					this.timerRounds += 1;
					this.runAsync(() => this.persistTimerRounds(), '保存番茄钟轮数失败。');
				}
				this.timerSeconds = this.timerTotalSeconds;
				this.showMockStatus(completedFocus ? '完成一轮专注' : '休息结束');
			}
			this.updateTimer();
		}, 1000);
		this.updateTimer();
	}

	private stopTimer(nextState: TimerState = 'idle'): void {
		if (this.timerId !== null) this.contentEl.ownerDocument.defaultView?.clearInterval(this.timerId);
		this.timerId = null;
		this.timerEndAt = null;
		this.timerState = nextState;
	}

	private updateTimerFromClock(): void {
		if (this.timerEndAt === null) return;
		this.timerSeconds = Math.max(0, Math.ceil((this.timerEndAt - Date.now()) / 1000));
	}

	private updateTimer(): void {
		const minutes = Math.floor(this.timerSeconds / 60);
		const seconds = this.timerSeconds % 60;
		this.timerValueEl?.setText(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
		const isFocus = this.timerTotalSeconds === 25 * 60;
		const activity = isFocus ? '专注' : '休息';
		const stateLabel = this.timerState === 'running' ? `${activity}中` : this.timerState === 'paused' ? '已暂停' : '未开始';
		this.timerStartEl?.setText(this.timerState === 'running' ? '暂停' : `${this.timerState === 'paused' ? '继续' : '开始'}${activity}`);
		this.timerRoundsEl?.setText(`今日 ${this.timerRounds} 轮`);
		this.timerCardEl?.setAttribute('data-timer-state', this.timerState);
		if (this.timerRingEl) {
			this.timerRingEl.dataset.progress = String(Math.round((this.timerSeconds / this.timerTotalSeconds) * 10));
			this.timerRingEl.setAttr('aria-label', `番茄钟${stateLabel}，剩余 ${minutes} 分 ${seconds} 秒`);
		}
	}

	private async persistTimerRounds(): Promise<void> {
		await this.updateSettings({
			...this.getSettings(),
			pomodoroDate: this.currentDateKey(),
			pomodoroRounds: this.timerRounds,
		});
	}

	private currentDateKey(): string {
		const date = new Date();
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	}

	private showMockStatus(message: string): void {
		this.statusEl?.setText(message);
		this.statusEl?.addClass('is-visible');
		const viewWindow = this.contentEl.ownerDocument.defaultView;
		if (!viewWindow) return;
		if (this.statusTimerId !== null) viewWindow.clearTimeout(this.statusTimerId);
		this.statusTimerId = viewWindow.setTimeout(() => {
			this.statusEl?.removeClass('is-visible');
			this.statusTimerId = null;
		}, 2400);
	}

	private createObjectUrl(file: File): string {
		return this.contentEl.ownerDocument.defaultView?.URL.createObjectURL(file) ?? '';
	}

	private revokeObjectUrl(url: string | null): void {
		if (url) this.contentEl.ownerDocument.defaultView?.URL.revokeObjectURL(url);
	}

	private svgToDataUrl(svg: string): string {
		return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
	}

	private isSameDate(first: Date, second: Date): boolean {
		return first.getFullYear() === second.getFullYear()
			&& first.getMonth() === second.getMonth()
			&& first.getDate() === second.getDate();
	}

	private getCalendarTasks(date: Date): DashboardTask[] {
		const key = this.dateKey(date);
		return this.taskState.filter((task) => !task.completed && task.dueDate === key);
	}

	private getDeadlineUrgency(tasks: DashboardTask[], today: Date): 'red' | 'yellow' | 'green' | null {
		const deadlines = tasks.filter((task) => task.kind === 'ddl');
		if (!deadlines.length) return null;
		const due = this.parseDate(deadlines[0]!.dueDate);
		if (!due) return null;
		const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
		const days = Math.round((due.getTime() - todayStart.getTime()) / 86_400_000);
		if (days <= 1) return 'red';
		if (days <= 3) return 'yellow';
		return 'green';
	}

	private parseDate(value: string): Date | null {
		const [year, month, day] = value.split('-').map(Number);
		if (year === undefined || month === undefined || day === undefined) return null;
		if (![year, month, day].every(Number.isFinite)) return null;
		return new Date(year, month - 1, day);
	}

	private dateKey(date: Date): string {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	}
}
