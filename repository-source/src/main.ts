import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	AgentDashboardSettingTab,
	normalizeSettings,
	type AgentDashboardSettings,
} from './settings';
import { AgentDashboardView } from './views/AgentDashboardView';
import { DashboardVaultService } from './services/DashboardVaultService';
import { DashboardTaskService } from './services/DashboardTaskService';
import { DashboardActions } from './services/DashboardActions';
import { QuickNoteService } from './services/QuickNoteService';
import { RssService } from './services/RssService';
import type { RssSubscription, RssTestResult } from './rss/types';
import { AiService } from './services/AiService';
import type { AiDetectedTool, AiProviderTestResult } from './ai/types';

export default class AgentDashboardPlugin extends Plugin {
	settings: AgentDashboardSettings = DEFAULT_SETTINGS;
	private emptyCheckTimer: number | null = null;
	private openingDashboard = false;
	private rssService!: RssService;
	private aiService!: AiService;
	private nextRssRefreshAt: number | null = null;
	private rssAutoRefreshRunning = false;
	private get viewType(): string {
		return `${this.manifest.id}-view`;
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		const vaultService = new DashboardVaultService(this.app, () => this.settings);
		const taskService = new DashboardTaskService(this.app, () => this.settings);
		const quickNoteService = new QuickNoteService(this.app);
		this.rssService = new RssService(this.app, () => this.settings);
		this.aiService = new AiService(this.app, () => this.settings);
		this.startRssAutoRefreshSchedule();
		const actions = new DashboardActions(this.app, vaultService, taskService, quickNoteService);

		this.registerView(
			this.viewType,
			(leaf: WorkspaceLeaf) => new AgentDashboardView(
				leaf,
				this.viewType,
				() => this.settings,
				(settings) => this.updateSettings(settings),
				vaultService,
				taskService,
				actions,
				this.rssService,
				this.aiService,
			),
		);

		this.addRibbonIcon('layout-dashboard', '打开仪表盘', () => {
			this.openDashboard();
		});

		this.addCommand({
			id: 'open-dashboard',
			name: '打开仪表盘',
			callback: () => {
				this.openDashboard();
			},
		});

		this.addSettingTab(new AgentDashboardSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.openOnStartup) this.openDashboard(true);
		});
		this.registerEvent(this.app.workspace.on('layout-change', () => this.queueEmptyWorkspaceCheck()));
		this.register(() => {
			const viewWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
			if (this.emptyCheckTimer !== null) viewWindow?.clearTimeout(this.emptyCheckTimer);
		});
	}

	async updateSettings(settings: AgentDashboardSettings): Promise<void> {
		const inboxFolderChanged = settings.inboxFolder !== this.settings.inboxFolder;
		const taskFileChanged = settings.taskFilePath !== this.settings.taskFilePath;
		const quickNotesChanged = JSON.stringify(settings.quickNotes) !== JSON.stringify(this.settings.quickNotes);
		const rssSettingsChanged = settings.xboardDataFolder !== this.settings.xboardDataFolder
			|| JSON.stringify(settings.rssSubscriptions) !== JSON.stringify(this.settings.rssSubscriptions);
		const rssScheduleChanged = settings.rssAutoRefresh !== this.settings.rssAutoRefresh
			|| settings.rssRefreshIntervalMinutes !== this.settings.rssRefreshIntervalMinutes
			|| rssSettingsChanged;
		this.settings = settings;
		await this.saveData(settings);
		if (rssScheduleChanged) this.resetRssAutoRefreshSchedule();

		for (const leaf of this.app.workspace.getLeavesOfType(this.viewType)) {
			if (leaf.view instanceof AgentDashboardView) {
				leaf.view.applyDisplaySettings();
				if (quickNotesChanged) leaf.view.refreshQuickNoteActions();
				if (inboxFolderChanged) leaf.view.refreshVaultData();
				if (taskFileChanged) void leaf.view.refreshTaskData();
				if (rssSettingsChanged) void leaf.view.refreshRssData();
			}
		}
	}

	testRssSubscription(subscription: RssSubscription): Promise<RssTestResult> {
		return this.rssService.testSubscription(subscription);
	}

	testAiProvider(): Promise<AiProviderTestResult> {
		return this.aiService.testProvider();
	}

	detectAiTools(force = false): Promise<AiDetectedTool[]> {
		return this.aiService.detectTools(force);
	}

	onunload(): void {
		this.nextRssRefreshAt = null;
		this.aiService?.cancelActiveRun();
	}

	private async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	private startRssAutoRefreshSchedule(): void {
		this.resetRssAutoRefreshSchedule();
		const viewWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
		if (!viewWindow) return;
		this.registerInterval(viewWindow.setInterval(() => {
			void this.checkRssAutoRefresh();
		}, 60_000));
	}

	private resetRssAutoRefreshSchedule(): void {
		this.nextRssRefreshAt = this.settings.rssAutoRefresh
			? Date.now() + (this.settings.rssRefreshIntervalMinutes * 60_000)
			: null;
	}

	private async checkRssAutoRefresh(): Promise<void> {
		if (!this.settings.rssAutoRefresh || this.rssAutoRefreshRunning) return;
		if (this.nextRssRefreshAt === null) {
			this.resetRssAutoRefreshSchedule();
			return;
		}
		if (Date.now() < this.nextRssRefreshAt) return;
		if (!this.settings.rssSubscriptions.some((subscription) => subscription.enabled)) {
			this.resetRssAutoRefreshSchedule();
			return;
		}

		this.rssAutoRefreshRunning = true;
		try {
			await this.rssService.refreshAll();
			for (const leaf of this.app.workspace.getLeavesOfType(this.viewType)) {
				if (leaf.view instanceof AgentDashboardView) await leaf.view.refreshRssData();
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : '未知错误';
			new Notice(`Xboard 自动刷新外部消息失败：${message}`);
		} finally {
			this.rssAutoRefreshRunning = false;
			this.resetRssAutoRefreshSchedule();
		}
	}

	private async activateDashboard(refresh = false): Promise<void> {
		if (this.openingDashboard) return;
		this.openingDashboard = true;
		try {
			const { workspace } = this.app;
			let leaf = workspace.getLeavesOfType(this.viewType)[0];

			if (!leaf) {
				let emptyLeaf: WorkspaceLeaf | null = null;
				workspace.iterateRootLeaves((candidate) => {
					if (!emptyLeaf && candidate.view.getViewType() === 'empty') emptyLeaf = candidate;
				});
				leaf = emptyLeaf ?? workspace.getLeaf(true);
				await leaf.setViewState({
					type: this.viewType,
					active: true,
				});
			}

			await workspace.revealLeaf(leaf);
			if (refresh && leaf.view instanceof AgentDashboardView) await leaf.view.refreshDashboard();
		} finally {
			this.openingDashboard = false;
		}
	}

	private openDashboard(refresh = false): void {
		void this.activateDashboard(refresh).catch((error: unknown) => {
			new Notice(error instanceof Error ? error.message : '打开 Xboard 失败。');
		});
	}

	private queueEmptyWorkspaceCheck(): void {
		if (!this.settings.openWhenEmpty || this.openingDashboard) return;
		const viewWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
		if (!viewWindow) return;
		if (this.emptyCheckTimer !== null) viewWindow.clearTimeout(this.emptyCheckTimer);
		this.emptyCheckTimer = viewWindow.setTimeout(() => {
			this.emptyCheckTimer = null;
			if (!this.settings.openWhenEmpty || this.app.workspace.getLeavesOfType(this.viewType).length > 0) return;
			let hasContent = false;
			this.app.workspace.iterateRootLeaves((leaf) => {
				if (leaf.view.getViewType() !== 'empty') hasContent = true;
			});
			if (!hasContent) this.openDashboard(true);
		}, 120);
	}
}
