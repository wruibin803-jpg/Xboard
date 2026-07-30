export interface RssSubscription {
	id: string;
	name: string;
	url: string;
	category: string;
	enabled: boolean;
}

export interface RssItem {
	id: string;
	feedId: string;
	feedName: string;
	category: string;
	title: string;
	link: string;
	summary: string;
	publishedAt: string | null;
	author: string;
}

export interface RssFeedStatus {
	feedId: string;
	feedName: string;
	fetchedAt: string;
	itemCount: number;
	error?: string;
}

export interface RssCache {
	version: 1;
	updatedAt: string;
	items: RssItem[];
	statuses: RssFeedStatus[];
}

export interface ParsedRssFeed {
	title: string;
	items: Array<{
		id: string;
		title: string;
		link: string;
		summary: string;
		publishedAt: string | null;
		author: string;
	}>;
}

export interface RssRefreshResult {
	cache: RssCache;
	successCount: number;
	errorCount: number;
}

export interface RssTestResult {
	feedTitle: string;
	itemCount: number;
}
