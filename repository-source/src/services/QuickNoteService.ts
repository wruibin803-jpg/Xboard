import { App, normalizePath, TFile, TFolder } from 'obsidian';
import { defaultTemplateFor } from '../quick-notes/defaults';
import type {
	QuickNoteDefinition,
	QuickNoteFieldValue,
	QuickNoteValues,
} from '../quick-notes/types';

const PLACEHOLDER_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

export class QuickNoteService {
	constructor(private readonly app: App) {}

	async createNote(definition: QuickNoteDefinition, values: QuickNoteValues): Promise<TFile> {
		const destination = this.requireExistingFolder(definition.destinationFolder);
		const now = new Date();
		const variables = this.createVariables(values, now);
		const template = await this.readTemplate(definition);
		const content = this.renderTemplate(template, variables);
		const renderedName = this.renderTemplate(definition.fileNameTemplate, variables);
		if (/\{\{\s*[^{}\s]+\s*\}\}/.test(renderedName)) {
			throw new Error('文件名规则包含无法识别的变量，请检查快速笔记设置。');
		}
		const baseName = this.sanitizeFileName(renderedName);
		if (!baseName) throw new Error('文件名规则生成了空文件名，请检查快速笔记设置。');
		const path = this.findAvailablePath(destination, baseName);
		return this.app.vault.create(path, content);
	}

	private async readTemplate(definition: QuickNoteDefinition): Promise<string> {
		const rawPath = definition.templatePath.trim();
		if (!rawPath) return defaultTemplateFor(definition);
		const path = normalizePath(rawPath);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== 'md') {
			throw new Error(`模板文件“${path}”不存在或不是 Markdown 文件。`);
		}
		return this.app.vault.cachedRead(file);
	}

	private createVariables(values: QuickNoteValues, now: Date): Record<string, string> {
		const variables: Record<string, string> = {
			date: this.localDate(now),
			time: this.localTime(now),
			timeCompact: this.localTimeCompact(now),
			datetime: now.toISOString(),
		};
		for (const [key, value] of Object.entries(values)) {
			variables[key] = this.stringifyValue(value);
		}
		return variables;
	}

	private stringifyValue(value: QuickNoteFieldValue): string {
		if (typeof value === 'boolean') return value ? '是' : '否';
		return value;
	}

	private renderTemplate(template: string, variables: Record<string, string>): string {
		return template.replace(PLACEHOLDER_PATTERN, (match, variable: string) => (
			Object.prototype.hasOwnProperty.call(variables, variable) ? variables[variable]! : match
		));
	}

	private requireExistingFolder(folderPath: string): string {
		const path = normalizePath(folderPath.trim());
		if (!path || path === '/') throw new Error('请先为此快速笔记选择保存目录。');
		if (path === this.app.vault.configDir || path.startsWith(`${this.app.vault.configDir}/`)) {
			throw new Error('快速笔记不能保存到 Obsidian 配置目录。');
		}
		const folder = this.app.vault.getAbstractFileByPath(path);
		if (!(folder instanceof TFolder)) throw new Error(`保存目录“${path}”不存在，请检查快速笔记设置。`);
		return path;
	}

	private findAvailablePath(folder: string, baseName: string): string {
		let index = 1;
		let path = normalizePath(`${folder}/${baseName}.md`);
		while (this.app.vault.getAbstractFileByPath(path)) {
			index += 1;
			path = normalizePath(`${folder}/${baseName}-${index}.md`);
		}
		return path;
	}

	private sanitizeFileName(value: string): string {
		const forbidden = new Set('\\/:*?"<>|#^[]');
		return [...value.trim()]
			.map((character) => forbidden.has(character) ? '-' : character)
			.join('')
			.replace(/\s+/g, ' ')
			.replace(/-+/g, '-')
			.replace(/[. ]+$/g, '')
			.slice(0, 120);
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
