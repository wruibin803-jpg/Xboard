import type { RssSubscription } from './types';

export function createBlankRssSubscription(): RssSubscription {
	return {
		id: `rss-${Date.now().toString(36)}`,
		name: '新订阅',
		url: '',
		category: '未分类',
		enabled: true,
	};
}
