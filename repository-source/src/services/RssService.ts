import { App, normalizePath, requestUrl, TFile, TFolder } from 'obsidian';
import type { AgentDashboardSettings } from '../settings';
import { parseRssText } from '../rss/parser';
import type {
	RssCache,
	RssFeedStatus,
	RssItem,
	RssRefreshResult,
	RssSubscription,
	RssTestResult,
} from '../rss/types';

const CACHE_VERSION = 1;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

export class RssService {
	private refreshPromise: Promise<RssRefreshResult> | null = null;

	constructor(
		private readonly app: App,
		private readonly getSettings: () => AgentDashboardSettings,
	) {}

	getCachePath(): string {
		return normalizePath(`${this.requireDataFolder()}/RSS 缓存/订阅缓存.json`);
	}

	async readCache(): Promise<RssCache | null> {
		const file = this.app.vault.getAbstractFileByPath(this.getCachePath());
		if (!file) return null;
		if (!(file instanceof TFile)) throw new Error('外部消息缓存路径不是文件，请检查“Xboard 数据”目录。');
		try {
			return normalizeCache(JSON.parse(await this.app.vault.read(file)));
		} catch {
			throw new Error('外部消息缓存无法读取，可手动刷新来重新生成。');
		}
	}

	async testSubscription(subscription: RssSubscription): Promise<RssTestResult> {
		const parsed = await this.fetchSubscription(subscription);
		return { feedTitle: parsed.feedTitle, itemCount: parsed.items.length };
	}

	async refreshAll(): Promise<RssRefreshResult> {
		if (this.refreshPromise) return this.refreshPromise;
		const refresh = this.performRefresh();
		this.refreshPromise = refresh;
		try {
			return await refresh;
		} finally {
			if (this.refreshPromise === refresh) this.refreshPromise = null;
		}
	}

	private async performRefresh(): Promise<RssRefreshResult> {
		const settings = this.getSettings();
		const subscriptions = settings.rssSubscriptions.filter((subscription) => subscription.enabled);
		if (subscriptions.length === 0) throw new Error('请先在设置中启用至少一个外部消息来源。');

		const previous = await this.readCache();
		const previousByFeed = new Map<string, RssItem[]>();
		for (const item of previous?.items ?? []) {
			const items = previousByFeed.get(item.feedId) ?? [];
			items.push(item);
			previousByFeed.set(item.feedId, items);
		}

		const fetchedAt = new Date().toISOString();
		const statuses: RssFeedStatus[] = [];
		const items: RssItem[] = [];
		let successCount = 0;
		let errorCount = 0;
		for (const subscription of subscriptions) {
			try {
				const result = await this.fetchSubscription(subscription);
				successCount += 1;
				const merged = this.mergeFeedItems(
					result.items,
					previousByFeed.get(subscription.id) ?? [],
					settings.rssRetentionDays,
					settings.rssMaxItemsPerFeed,
				);
				items.push(...merged);
				statuses.push({
					feedId: subscription.id,
					feedName: subscription.name,
					fetchedAt,
					itemCount: merged.length,
				});
			} catch (error) {
				errorCount += 1;
				const retained = this.mergeFeedItems(
					[],
					previousByFeed.get(subscription.id) ?? [],
					settings.rssRetentionDays,
					settings.rssMaxItemsPerFeed,
				);
				items.push(...retained);
				statuses.push({
					feedId: subscription.id,
					feedName: subscription.name,
					fetchedAt,
					itemCount: retained.length,
					error: error instanceof Error ? error.message : '拉取失败。',
				});
			}
		}

		const cache: RssCache = {
			version: CACHE_VERSION,
			updatedAt: fetchedAt,
			items: this.sortItems(items),
			statuses,
		};
		await this.writeCache(cache);
		return { cache, successCount, errorCount };
	}

	private async fetchSubscription(subscription: RssSubscription): Promise<{
		feedTitle: string;
		items: RssItem[];
	}> {
		const url = this.requireHttpUrl(subscription.url);
		const response = await requestUrl({
			url,
			method: 'GET',
			headers: {
				Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5',
			},
			throw: false,
		});
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`连接失败（HTTP ${response.status}）。`);
		}
		if (!response.text.trim()) throw new Error('订阅返回了空内容。');
		if (new TextEncoder().encode(response.text).byteLength > MAX_RESPONSE_SIZE) {
			throw new Error('订阅内容超过 5 MB，已停止处理。');
		}
		const viewWindow = this.app.workspace.containerEl.ownerDocument.defaultView;
		const DomParser = viewWindow?.DOMParser;
		if (!DomParser) throw new Error('当前窗口无法解析 RSS。');
		const parsed = parseRssText(response.text, url, subscription.id, DomParser);
		return {
			feedTitle: parsed.title,
			items: parsed.items.map((item) => ({
				...item,
				feedId: subscription.id,
				feedName: subscription.name || parsed.title,
				category: subscription.category,
			})),
		};
	}

	private mergeFeedItems(
		nextItems: RssItem[],
		previousItems: RssItem[],
		retentionDays: number,
		maximum: number,
	): RssItem[] {
		const cutoff = Date.now() - retentionDays * 86_400_000;
		const unique = new Map<string, RssItem>();
		for (const item of [...nextItems, ...previousItems]) {
			if (item.publishedAt && Date.parse(item.publishedAt) < cutoff) continue;
			if (!unique.has(item.id)) unique.set(item.id, item);
		}
		return this.sortItems([...unique.values()]).slice(0, maximum);
	}

	private sortItems(items: RssItem[]): RssItem[] {
		return items.sort((first, second) => {
			const firstTime = first.publishedAt ? Date.parse(first.publishedAt) : 0;
			const secondTime = second.publishedAt ? Date.parse(second.publishedAt) : 0;
			return secondTime - firstTime || first.title.localeCompare(second.title);
		});
	}

	private async writeCache(cache: RssCache): Promise<void> {
		const path = this.getCachePath();
		const separator = path.lastIndexOf('/');
		await this.ensureFolder(path.slice(0, separator));
		const content = `${JSON.stringify(cache, null, 2)}\n`;
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!existing) {
			await this.app.vault.create(path, content);
			return;
		}
		if (!(existing instanceof TFile)) throw new Error('外部消息缓存路径被同名文件夹占用。');
		await this.app.vault.process(existing, () => content);
	}

	private async ensureFolder(path: string): Promise<void> {
		let current = '';
		for (const segment of normalizePath(path).split('/').filter(Boolean)) {
			current = current ? `${current}/${segment}` : segment;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) {
				await this.app.vault.createFolder(current);
				continue;
			}
			if (!(existing instanceof TFolder)) throw new Error(`“${current}”不是文件夹。`);
		}
	}

	private requireDataFolder(): string {
		const raw = this.getSettings().xboardDataFolder.trim();
		if (!raw) throw new Error('请先在设置中填写 Xboard 数据目录。');
		const path = normalizePath(raw);
		if (path === '/' || path.split('/').some((segment) => segment === '.' || segment === '..')) {
			throw new Error('Xboard 数据目录无效。');
		}
		if (path === this.app.vault.configDir || path.startsWith(`${this.app.vault.configDir}/`)) {
			throw new Error('Xboard 数据目录不能放在 Obsidian 配置目录中。');
		}
		return path;
	}

	private requireHttpUrl(value: string): string {
		try {
			const url = new URL(value.trim());
			if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
			return url.href;
		} catch {
			throw new Error('订阅地址必须以 http:// 或 https:// 开头。');
		}
	}
}

function normalizeCache(value: unknown): RssCache {
	if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.statuses)) throw new Error();
	const items = value.items.map(normalizeItem).filter((item): item is RssItem => item !== null);
	const statuses = value.statuses.map(normalizeStatus).filter((status): status is RssFeedStatus => status !== null);
	return {
		version: CACHE_VERSION,
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
		items,
		statuses,
	};
}

function normalizeItem(value: unknown): RssItem | null {
	if (!isRecord(value) || typeof value.id !== 'string' || typeof value.feedId !== 'string' || typeof value.title !== 'string') return null;
	return {
		id: value.id,
		feedId: value.feedId,
		feedName: typeof value.feedName === 'string' ? value.feedName : '',
		category: typeof value.category === 'string' ? value.category : '',
		title: value.title,
		link: typeof value.link === 'string' ? value.link : '',
		summary: typeof value.summary === 'string' ? value.summary : '',
		publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
		author: typeof value.author === 'string' ? value.author : '',
	};
}

function normalizeStatus(value: unknown): RssFeedStatus | null {
	if (!isRecord(value) || typeof value.feedId !== 'string') return null;
	return {
		feedId: value.feedId,
		feedName: typeof value.feedName === 'string' ? value.feedName : '',
		fetchedAt: typeof value.fetchedAt === 'string' ? value.fetchedAt : '',
		itemCount: typeof value.itemCount === 'number' ? value.itemCount : 0,
		error: typeof value.error === 'string' ? value.error : undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
