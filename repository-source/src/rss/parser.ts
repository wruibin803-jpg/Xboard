import type { ParsedRssFeed } from './types';

const MAX_SUMMARY_LENGTH = 320;

export function parseRssText(
	xml: string,
	feedUrl: string,
	feedId: string,
	DomParser: typeof DOMParser,
): ParsedRssFeed {
	const parser = new DomParser();
	const document = parser.parseFromString(xml, 'application/xml');
	if (findElements(document, 'parsererror').length > 0) {
		throw new Error('返回内容不是有效的 RSS 或 Atom 文档。');
	}

	const root = document.documentElement;
	if (!root) throw new Error('订阅内容为空。');
	const rootName = root.localName.toLocaleLowerCase();
	const isAtom = rootName === 'feed';
	const channel = firstDescendant(root, 'channel');
	const itemElements = isAtom
		? directChildren(root, 'entry')
		: findElements(root, 'item');
	if (!isAtom && !channel && itemElements.length === 0) {
		throw new Error('没有找到 RSS、RDF 或 Atom 订阅内容。');
	}

	const feedTitle = textOf(directChild(channel ?? root, 'title')) || new URL(feedUrl).hostname;
	const items = itemElements.map((item, index) => {
		const title = textOf(directChild(item, 'title')) || '无标题';
		const link = readLink(item, feedUrl);
		const guid = textOf(directChild(item, 'guid'))
			|| textOf(directChild(item, 'id'))
			|| link
			|| `${title}-${index}`;
		const publishedAt = readDate(item);
		const summaryHtml = textOf(directChild(item, 'description'))
			|| textOf(directChild(item, 'summary'))
			|| textOf(directChild(item, 'content'))
			|| textOf(directChild(item, 'encoded'));
		return {
			id: `${feedId}-${stableHash(guid)}`,
			title,
			link,
			summary: cleanSummary(summaryHtml, parser),
			publishedAt,
			author: textOf(directChild(item, 'author'))
				|| textOf(directChild(item, 'creator')),
		};
	});

	return { title: feedTitle, items };
}

function directChildren(parent: Element, localName: string): Element[] {
	const name = localName.toLocaleLowerCase();
	return Array.from(parent.children).filter((child) => child.localName.toLocaleLowerCase() === name);
}

function directChild(parent: Element, localName: string): Element | null {
	return directChildren(parent, localName)[0] ?? null;
}

function firstDescendant(parent: ParentNode, localName: string): Element | null {
	return findElements(parent, localName)[0] ?? null;
}

function findElements(parent: ParentNode, localName: string): Element[] {
	const name = localName.toLocaleLowerCase();
	return Array.from(parent.querySelectorAll('*')).filter((element) => element.localName.toLocaleLowerCase() === name);
}

function textOf(element: Element | null): string {
	return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function readLink(item: Element, feedUrl: string): string {
	const links = directChildren(item, 'link');
	const alternate = links.find((link) => {
		const rel = link.getAttribute('rel');
		return !rel || rel === 'alternate';
	}) ?? links[0];
	const raw = alternate?.getAttribute('href') ?? textOf(alternate ?? null);
	if (!raw) return '';
	try {
		const url = new URL(raw, feedUrl);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
	} catch {
		return '';
	}
}

function readDate(item: Element): string | null {
	const raw = textOf(directChild(item, 'pubDate'))
		|| textOf(directChild(item, 'published'))
		|| textOf(directChild(item, 'updated'))
		|| textOf(directChild(item, 'date'));
	if (!raw) return null;
	const timestamp = Date.parse(raw);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function cleanSummary(value: string, parser: DOMParser): string {
	if (!value) return '';
	const document = parser.parseFromString(value, 'text/html');
	const text = document.body?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
	return text.length > MAX_SUMMARY_LENGTH ? `${text.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…` : text;
}

function stableHash(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}
