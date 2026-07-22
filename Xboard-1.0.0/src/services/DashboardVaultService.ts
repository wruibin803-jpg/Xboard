import { App, normalizePath, TFile, TFolder } from 'obsidian';
import type { AgentDashboardSettings } from '../settings';

export type CaptureKind = 'diary' | 'project-log' | 'inbox';

export interface CaptureInput {
	kind: CaptureKind;
	title: string;
	content: string;
	inboxType?: '临时笔记' | '资料' | '待整理';
}

export interface HeatmapDay {
	date: Date;
	count: number;
	level: 0 | 1 | 2 | 3 | 4;
}

export interface HeatmapData {
	days: HeatmapDay[];
	activeDays: number;
	totalNotes: number;
	dateRange: string;
}

export interface UnresolvedLinkItem {
	source: string;
	target: string;
	count: number;
}

export interface VaultHealthBreakdown {
	connectivity: number;
	linkIntegrity: number;
	contentCompleteness: number;
}

export interface VaultHealthSummary {
	isEmpty: boolean;
	totalNotes: number;
	orphanCount: number;
	emptyCount: number;
	unresolvedLinkCount: number;
	healthScore: number;
	healthBreakdown: VaultHealthBreakdown;
}

export type FolderSummary =
	| { status: 'unconfigured'; count: 0 }
	| { status: 'missing'; count: 0; path: string }
	| { status: 'ready'; count: number; path: string };

export interface VaultCheckResult {
	totalNotes: number;
	orphanNotes: string[];
	emptyNotes: string[];
	unresolvedLinks: UnresolvedLinkItem[];
	unresolvedLinkCount: number;
	withoutFrontmatter: string[];
	healthScore: number;
	healthBreakdown: VaultHealthBreakdown;
}

interface VaultLinkState {
	orphanNotes: string[];
	unresolvedLinks: UnresolvedLinkItem[];
	resolvedLinkCount: number;
	unresolvedLinkCount: number;
}

export class DashboardVaultService {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => AgentDashboardSettings,
	) {}

	async createCapture(input: CaptureInput): Promise<TFile> {
		const settings = this.getSettings();
		const folder = input.kind === 'diary'
			? settings.diaryFolder
			: input.kind === 'project-log'
				? settings.projectLogFolder
				: settings.inboxFolder;
		const normalizedFolder = this.requireExistingFolder(folder);
		const now = new Date();
		const title = this.sanitizeFileName(input.title) || this.defaultTitle(input.kind, now);
		const baseName = input.kind === 'diary'
			? this.localDate(now)
			: `${this.localDate(now)}-${this.localTimeCompact(now)} ${title}`;
		const path = this.findAvailablePath(normalizedFolder, baseName);
		const content = this.captureContent(input, title, now);
		return this.app.vault.create(path, content);
	}

	async saveInspiration(content: string): Promise<TFile> {
		const normalizedFolder = this.requireExistingFolder(this.getSettings().inspirationFolder);
		const now = new Date();
		const path = normalizePath(`${normalizedFolder}/${this.localDate(now)}.md`);
		const line = `- ${this.localTime(now)} ${content.trim()}\n`;
		const existing = this.app.vault.getAbstractFileByPath(path);

		if (!existing) {
			return this.app.vault.create(path, `---\ntype: inspiration\ndate: ${this.localDate(now)}\n---\n\n# 灵感记录\n\n${line}`);
		}
		if (!(existing instanceof TFile)) throw new Error(`“${path}”不是 Markdown 文件。`);
		await this.app.vault.process(existing, (data) => `${data.trimEnd()}\n${line}`);
		return existing;
	}

	getFolderSummary(folderPath: string): FolderSummary {
		const path = normalizePath(folderPath.trim());
		if (!path || path === '/') return { status: 'unconfigured', count: 0 };
		const folder = this.app.vault.getAbstractFileByPath(path);
		if (!(folder instanceof TFolder)) return { status: 'missing', count: 0, path };
		return { status: 'ready', count: this.countFiles(folder), path };
	}

	getFolderFileCount(folderPath: string): number {
		return this.getFolderSummary(folderPath).count;
	}

	getVaultHealthSummary(): VaultHealthSummary {
		const files = this.app.vault.getMarkdownFiles();
		const links = this.collectLinkState(files);
		const emptyCount = files.filter((file) => file.stat.size === 0).length;
		const health = this.calculateHealth(
			files.length,
			links.orphanNotes.length,
			emptyCount,
			links.resolvedLinkCount,
			links.unresolvedLinkCount,
		);
		return {
			isEmpty: files.length === 0,
			totalNotes: files.length,
			orphanCount: links.orphanNotes.length,
			emptyCount,
			unresolvedLinkCount: links.unresolvedLinkCount,
			...health,
		};
	}

	getHeatmapData(): HeatmapData {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const start = new Date(today);
		start.setDate(start.getDate() - 364);
		const counts = new Map<string, number>();

		for (const file of this.app.vault.getMarkdownFiles()) {
			const created = new Date(file.stat.ctime);
			created.setHours(0, 0, 0, 0);
			if (created < start || created > today) continue;
			const key = this.localDate(created);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}

		const maximum = Math.max(1, ...counts.values());
		const days: HeatmapDay[] = [];
		for (let offset = 0; offset < 365; offset += 1) {
			const date = new Date(start);
			date.setDate(start.getDate() + offset);
			const count = counts.get(this.localDate(date)) ?? 0;
			const level = count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((count / maximum) * 4))) as 1 | 2 | 3 | 4;
			days.push({ date, count, level });
		}

		const formatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short' });
		return {
			days,
			activeDays: counts.size,
			totalNotes: [...counts.values()].reduce((sum, count) => sum + count, 0),
			dateRange: `${formatter.format(start)}–${formatter.format(today)}`,
		};
	}

	async runVaultCheck(): Promise<VaultCheckResult> {
		const files = this.app.vault.getMarkdownFiles();
		const links = this.collectLinkState(files);

		const emptyNotes: string[] = [];
		const withoutFrontmatter: string[] = [];
		for (const file of files) {
			if (file.stat.size === 0) emptyNotes.push(file.path);
			if (!this.app.metadataCache.getFileCache(file)?.frontmatter) withoutFrontmatter.push(file.path);
		}

		const health = this.calculateHealth(
			files.length,
			links.orphanNotes.length,
			emptyNotes.length,
			links.resolvedLinkCount,
			links.unresolvedLinkCount,
		);
		return {
			totalNotes: files.length,
			orphanNotes: links.orphanNotes,
			emptyNotes,
			unresolvedLinks: links.unresolvedLinks,
			unresolvedLinkCount: links.unresolvedLinkCount,
			withoutFrontmatter,
			...health,
		};
	}

	private collectLinkState(files: TFile[]): VaultLinkState {
		const markdownPaths = new Set(files.map((file) => file.path));
		const incoming = new Map<string, number>();
		const resolved = this.app.metadataCache.resolvedLinks;
		let resolvedLinkCount = 0;

		for (const targets of Object.values(resolved)) {
			for (const [target, count] of Object.entries(targets)) {
				resolvedLinkCount += count;
				if (!markdownPaths.has(target)) continue;
				incoming.set(target, (incoming.get(target) ?? 0) + count);
			}
		}

		const orphanNotes = files
			.filter((file) => {
				const outgoing = Object.keys(resolved[file.path] ?? {}).some((path) => markdownPaths.has(path));
				return !outgoing && (incoming.get(file.path) ?? 0) === 0;
			})
			.map((file) => file.path);

		const unresolvedLinks: UnresolvedLinkItem[] = [];
		let unresolvedLinkCount = 0;
		for (const [source, targets] of Object.entries(this.app.metadataCache.unresolvedLinks)) {
			for (const [target, count] of Object.entries(targets)) {
				unresolvedLinks.push({ source, target, count });
				unresolvedLinkCount += count;
			}
		}
		unresolvedLinks.sort((first, second) => second.count - first.count || first.source.localeCompare(second.source));
		return { orphanNotes, unresolvedLinks, resolvedLinkCount, unresolvedLinkCount };
	}

	private calculateHealth(
		totalNotes: number,
		orphanCount: number,
		emptyCount: number,
		resolvedLinkCount: number,
		unresolvedLinkCount: number,
	): Pick<VaultHealthSummary, 'healthScore' | 'healthBreakdown'> {
		if (totalNotes === 0) {
			return {
				healthScore: 0,
				healthBreakdown: { connectivity: 0, linkIntegrity: 0, contentCompleteness: 0 },
			};
		}
		const linkCount = resolvedLinkCount + unresolvedLinkCount;
		const healthBreakdown: VaultHealthBreakdown = {
			connectivity: Math.round(((totalNotes - orphanCount) / totalNotes) * 100),
			linkIntegrity: linkCount === 0 ? 100 : Math.round((resolvedLinkCount / linkCount) * 100),
			contentCompleteness: Math.round(((totalNotes - emptyCount) / totalNotes) * 100),
		};
		return {
			healthScore: Math.round(
				healthBreakdown.connectivity * 0.35
				+ healthBreakdown.linkIntegrity * 0.4
				+ healthBreakdown.contentCompleteness * 0.25,
			),
			healthBreakdown,
		};
	}

	private requireExistingFolder(folderPath: string): string {
		const normalized = normalizePath(folderPath.trim());
		if (!normalized || normalized === '/') throw new Error('请先在插件设置中填写有效目录。');
		const segments = normalized.split('/').filter(Boolean);
		if (segments.some((segment) => segment === '.' || segment === '..')) throw new Error('目录不能包含“.”或“..”。');
		if (normalized === this.app.vault.configDir || normalized.startsWith(`${this.app.vault.configDir}/`)) {
			throw new Error('笔记目录不能位于 Obsidian 配置目录中。');
		}
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (!(existing instanceof TFolder)) {
			throw new Error(`目标文件夹“${normalized}”不存在，请检查插件设置。插件不会自动创建目录。`);
		}
		return normalized;
	}

	private findAvailablePath(folder: string, baseName: string): string {
		const safeBase = this.sanitizeFileName(baseName) || '未命名笔记';
		let index = 1;
		let path = normalizePath(`${folder}/${safeBase}.md`);
		while (this.app.vault.getAbstractFileByPath(path)) {
			index += 1;
			path = normalizePath(`${folder}/${safeBase}-${index}.md`);
		}
		return path;
	}

	private captureContent(input: CaptureInput, title: string, now: Date): string {
		const type = input.kind === 'project-log' ? 'project-log' : input.kind;
		const fields = [
			'---',
			`type: ${type}`,
			`created: ${now.toISOString()}`,
		];
		if (input.kind === 'inbox') {
			fields.push(`inbox-type: ${input.inboxType ?? '临时笔记'}`, 'status: unprocessed');
		}
		fields.push('---', '', `# ${title}`, '');
		if (input.content.trim()) fields.push(input.content.trim(), '');
		return fields.join('\n');
	}

	private defaultTitle(kind: CaptureKind, date: Date): string {
		if (kind === 'diary') return `${this.localDate(date)} 日记`;
		if (kind === 'project-log') return `${this.localDate(date)} 项目日志`;
		return '临时笔记';
	}

	private sanitizeFileName(value: string): string {
		const forbidden = new Set('\\/:*?"<>|#^[]');
		return [...value.trim()]
			.map((character) => forbidden.has(character) ? '-' : character)
			.join('')
			.replace(/\s+/g, ' ')
			.replace(/-+/g, '-')
			.replace(/[. ]+$/g, '')
			.slice(0, 80);
	}

	private countFiles(folder: TFolder): number {
		let count = 0;
		for (const child of folder.children) {
			if (child instanceof TFile) count += 1;
			else if (child instanceof TFolder) count += this.countFiles(child);
		}
		return count;
	}

	private localDate(date: Date): string {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	}

	private localTime(date: Date): string {
		return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
	}

	private localTimeCompact(date: Date): string {
		return `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
	}
}
