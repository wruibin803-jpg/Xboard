import { App, normalizePath, TFile, TFolder } from 'obsidian';
import type { AgentDashboardSettings } from '../settings';

export type DashboardTaskScope = 'daily' | 'weekly';
export type DashboardTaskKind = 'todo' | 'ddl';
export type DashboardTaskPriority = 'high' | 'medium' | 'low';
export type DashboardTaskRepeat = 'none' | 'daily' | 'weekly';

export interface DashboardTask {
	id: string;
	title: string;
	note: string;
	dueDate: string;
	scope: DashboardTaskScope;
	kind: DashboardTaskKind;
	priority: DashboardTaskPriority;
	repeat: DashboardTaskRepeat;
	completedDates: string[];
	completed: boolean;
}

export type DashboardTaskInput = Omit<DashboardTask, 'id' | 'completed' | 'completedDates' | 'repeat'>
	& { repeat?: DashboardTaskRepeat };
export type DashboardTaskMove = 'top' | 'up' | 'down';

const SECTION_START = '<!-- xboard:tasks:start -->';
const SECTION_END = '<!-- xboard:tasks:end -->';
const TASK_PATTERN = /^- \[([ xX])\] .*?<!-- xboard:(.+) -->\s*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY_WEIGHT: Record<DashboardTaskPriority, number> = { high: 3, medium: 2, low: 1 };

interface StoredTask {
	id: string;
	title: string;
	note: string;
	dueDate: string;
	scope: DashboardTaskScope;
	kind: DashboardTaskKind;
	priority: DashboardTaskPriority;
	repeat?: DashboardTaskRepeat;
	completedDates?: string[];
}

interface ManagedRange {
	start: number;
	end: number;
}

export class DashboardTaskService {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => AgentDashboardSettings,
	) {}

	async readTasks(): Promise<DashboardTask[]> {
		const file = this.getTaskFile();
		if (!file) return [];
		return this.parseDocument(await this.app.vault.cachedRead(file));
	}

	async addTask(input: DashboardTaskInput): Promise<DashboardTask> {
		const task: DashboardTask = {
			...input,
			repeat: input.repeat ?? 'none',
			completedDates: [],
			id: this.createId(),
			completed: false,
		};
		await this.mutate((tasks) => {
			const sameScope = tasks.filter((candidate) => candidate.scope === task.scope);
			const otherScope = tasks.filter((candidate) => candidate.scope !== task.scope);
			const insertion = sameScope.findIndex((candidate) => PRIORITY_WEIGHT[candidate.priority] < PRIORITY_WEIGHT[task.priority]);
			sameScope.splice(insertion < 0 ? sameScope.length : insertion, 0, task);
			return task.scope === 'daily' ? [...sameScope, ...otherScope] : [...otherScope, ...sameScope];
		});
		return task;
	}

	async setCompleted(id: string, completed: boolean): Promise<void> {
		await this.mutate((tasks) => tasks.map((task) => {
			if (task.id !== id) return task;
			if (task.repeat === 'none') return { ...task, completed };
			const today = this.currentDateKey();
			const completedDates = completed
				? [...new Set([...task.completedDates, today])]
				: task.completedDates.filter((date) => !this.isSamePeriod(date, today, task.repeat));
			return { ...task, completedDates, completed };
		}));
	}

	async deleteTask(id: string): Promise<void> {
		await this.mutate((tasks) => tasks.filter((task) => task.id !== id));
	}

	async moveTask(id: string, move: DashboardTaskMove): Promise<void> {
		await this.mutate((tasks) => {
			const task = tasks.find((candidate) => candidate.id === id);
			if (!task) return tasks;
			const scoped = tasks.filter((candidate) => candidate.scope === task.scope);
			const current = scoped.findIndex((candidate) => candidate.id === id);
			const target = move === 'top' ? 0 : move === 'up' ? current - 1 : current + 1;
			if (current < 0 || target < 0 || target >= scoped.length || current === target) return tasks;
			const [moved] = scoped.splice(current, 1);
			if (moved) scoped.splice(target, 0, moved);
			const other = tasks.filter((candidate) => candidate.scope !== task.scope);
			return task.scope === 'daily' ? [...scoped, ...other] : [...other, ...scoped];
		});
	}

	isTaskFile(file: TFile): boolean {
		return this.isTaskPath(file.path);
	}

	isTaskPath(path: string): boolean {
		try {
			return normalizePath(path) === this.taskPath();
		} catch {
			return false;
		}
	}

	private async mutate(mutator: (tasks: DashboardTask[]) => DashboardTask[]): Promise<void> {
		const path = this.taskPath();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!existing) {
			this.requireExistingParent(path);
			await this.app.vault.create(path, this.renderDocument(mutator([])));
			return;
		}
		if (!(existing instanceof TFile)) throw new Error(`“${path}”不是 Markdown 文件。`);
		await this.app.vault.process(existing, (content) => this.replaceManagedSection(content, mutator(this.parseDocument(content))));
	}

	private getTaskFile(): TFile | null {
		const path = this.taskPath();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!existing) return null;
		if (!(existing instanceof TFile)) throw new Error(`“${path}”不是 Markdown 文件。`);
		return existing;
	}

	private taskPath(): string {
		const path = normalizePath(this.getSettings().taskFilePath.trim());
		if (!path || path === '/' || !path.toLowerCase().endsWith('.md')) {
			throw new Error('任务文件路径必须是有效的 Markdown 文件路径。');
		}
		if (path === this.app.vault.configDir || path.startsWith(`${this.app.vault.configDir}/`)) {
			throw new Error('任务文件不能位于 Obsidian 配置目录中。');
		}
		return path;
	}

	private requireExistingParent(path: string): void {
		const parts = path.split('/');
		parts.pop();
		const parentPath = parts.join('/');
		if (!parentPath) return;
		const parent = this.app.vault.getAbstractFileByPath(parentPath);
		if (!(parent instanceof TFolder)) {
			throw new Error(`任务文件所在目录“${parentPath}”不存在，插件不会自动创建目录。`);
		}
	}

	private parseDocument(content: string): DashboardTask[] {
		const tasks: DashboardTask[] = [];
		const range = this.findManagedRange(content);
		const managed = range ? content.slice(range.start + SECTION_START.length, range.end) : content;
		for (const line of managed.split(/\r?\n/)) {
			const match = TASK_PATTERN.exec(line);
			if (!match) continue;
			try {
				const value: unknown = JSON.parse(decodeURIComponent(match[2] ?? ''));
				if (!this.isStoredTask(value)) continue;
				const repeat = value.repeat === 'daily' || value.repeat === 'weekly' ? value.repeat : 'none';
				const completedDates = Array.isArray(value.completedDates)
					? value.completedDates.filter((date): date is string => typeof date === 'string' && DATE_PATTERN.test(date))
					: [];
				tasks.push({
					...value,
					repeat,
					completedDates,
					completed: repeat === 'none'
						? (match[1] ?? '').toLowerCase() === 'x'
						: this.isRepeatCompleted(repeat, completedDates),
				});
			} catch {
				continue;
			}
		}
		return tasks;
	}

	private replaceManagedSection(content: string, tasks: DashboardTask[]): string {
		const section = this.renderSection(tasks);
		const range = this.findManagedRange(content);
		if (!range) return `${content.trimEnd()}\n\n${section}\n`;
		return `${content.slice(0, range.start)}${section}${content.slice(range.end + SECTION_END.length)}`;
	}

	private findManagedRange(content: string): ManagedRange | null {
		const start = content.indexOf(SECTION_START);
		const end = content.indexOf(SECTION_END);
		const hasStart = start >= 0;
		const hasEnd = end >= 0;
		const duplicateStart = hasStart && content.indexOf(SECTION_START, start + SECTION_START.length) >= 0;
		const duplicateEnd = hasEnd && content.indexOf(SECTION_END, end + SECTION_END.length) >= 0;
		if (hasStart !== hasEnd || duplicateStart || duplicateEnd || (hasStart && end <= start)) {
			throw new Error('任务文件中的 Xboard 管理标记不完整或重复，请先修复标记后再保存任务。');
		}
		return hasStart ? { start, end } : null;
	}

	private renderDocument(tasks: DashboardTask[]): string {
		return `# Xboard 待办\n\n${this.renderSection(tasks)}\n`;
	}

	private renderSection(tasks: DashboardTask[]): string {
		const lines = tasks.map((task) => {
			const stored: StoredTask = {
				id: task.id,
				title: task.title,
				note: task.note,
				dueDate: task.dueDate,
				scope: task.scope,
				kind: task.kind,
				priority: task.priority,
				repeat: task.repeat,
				completedDates: task.completedDates,
			};
			const metadata = encodeURIComponent(JSON.stringify(stored));
			const priority = task.priority === 'high' ? '🔺' : task.priority === 'medium' ? '🔸' : '▫️';
			const kind = task.kind === 'ddl' ? 'DDL' : '待办';
			const title = task.title.replace(/\r?\n/g, ' ').replaceAll('<!--', '').trim();
			const repeat = task.repeat === 'daily' ? ' 🔁 每天' : task.repeat === 'weekly' ? ' 🔁 每周' : '';
			return `- [${task.completed ? 'x' : ' '}] ${title} ${priority} ${kind} 📅 ${task.dueDate}${repeat} <!-- xboard:${metadata} -->`;
		});
		return [SECTION_START, ...lines, SECTION_END].join('\n');
	}

	private isStoredTask(value: unknown): value is StoredTask {
		if (!value || typeof value !== 'object') return false;
		const task = value as Partial<Record<keyof StoredTask, unknown>>;
		return typeof task.id === 'string'
			&& typeof task.title === 'string'
			&& typeof task.note === 'string'
			&& typeof task.dueDate === 'string'
			&& DATE_PATTERN.test(task.dueDate)
			&& (task.scope === 'daily' || task.scope === 'weekly')
			&& (task.kind === 'todo' || task.kind === 'ddl')
			&& (task.priority === 'high' || task.priority === 'medium' || task.priority === 'low')
			&& (task.repeat === undefined || task.repeat === 'none' || task.repeat === 'daily' || task.repeat === 'weekly')
			&& (task.completedDates === undefined || (
				Array.isArray(task.completedDates)
				&& task.completedDates.every((date) => typeof date === 'string' && DATE_PATTERN.test(date))
			));
	}

	private isRepeatCompleted(repeat: DashboardTaskRepeat, completedDates: string[]): boolean {
		const today = this.currentDateKey();
		return completedDates.some((date) => this.isSamePeriod(date, today, repeat));
	}

	private isSamePeriod(first: string, second: string, repeat: DashboardTaskRepeat): boolean {
		if (repeat === 'daily' || repeat === 'none') return first === second;
		const firstDate = new Date(`${first}T00:00:00`);
		const secondDate = new Date(`${second}T00:00:00`);
		const startOfWeek = (date: Date): number => {
			const copy = new Date(date);
			const day = (copy.getDay() + 6) % 7;
			copy.setDate(copy.getDate() - day);
			copy.setHours(0, 0, 0, 0);
			return copy.getTime();
		};
		return startOfWeek(firstDate) === startOfWeek(secondDate);
	}

	private currentDateKey(): string {
		const now = new Date();
		return [
			now.getFullYear(),
			String(now.getMonth() + 1).padStart(2, '0'),
			String(now.getDate()).padStart(2, '0'),
		].join('-');
	}

	private createId(): string {
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}
}
