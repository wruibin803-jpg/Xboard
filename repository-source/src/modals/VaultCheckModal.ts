import { App, Modal, Notice, setIcon } from 'obsidian';
import type { DashboardVaultService, VaultCheckResult } from '../services/DashboardVaultService';

interface VaultCheckModalOptions {
	service: DashboardVaultService;
	onComplete: (result: VaultCheckResult) => void;
	onOpenFile: (path: string) => Promise<void>;
}

export class VaultCheckModal extends Modal {
	private closed = false;

	constructor(app: App, private readonly options: VaultCheckModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.closed = false;
		this.modalEl.addClass('agent-dashboard-check-modal');
		this.titleEl.setText('知识库检查');
		const loading = this.contentEl.createDiv({
			cls: 'agent-dashboard-check-loading',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		const icon = loading.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(icon, 'loader-circle');
		loading.createSpan({ text: '正在检查链接与笔记结构…' });
		void this.load();
	}

	onClose(): void {
		this.closed = true;
		this.contentEl.empty();
	}

	private async load(): Promise<void> {
		try {
			const result = await this.options.service.runVaultCheck();
			if (this.closed) return;
			this.options.onComplete(result);
			this.renderResult(result);
		} catch (error) {
			if (this.closed) return;
			this.contentEl.empty();
			this.contentEl.createEl('p', {
				cls: 'agent-dashboard-check-error',
				text: error instanceof Error ? error.message : '知识库检查失败。',
			});
			new Notice('知识库检查失败。');
		}
	}

	private renderResult(result: VaultCheckResult): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			cls: 'agent-dashboard-modal-description',
			text: '分数由连接性 35%、链接完整性 40%、内容完整性 25% 加权计算；无属性笔记仅作提示，不扣分。本次检查不会修改或删除文件。',
		});

		const score = this.contentEl.createDiv({ cls: 'agent-dashboard-check-score' });
		const scoreValue = score.createDiv();
		scoreValue.createEl('strong', { text: result.totalNotes === 0 ? '—' : String(result.healthScore) });
		scoreValue.createSpan({ text: '/100' });
		const scoreCopy = score.createDiv();
		scoreCopy.createEl('strong', { text: '知识库健康度' });
		scoreCopy.createEl('p', {
			text: result.totalNotes === 0
				? '还没有 Markdown 笔记。'
				: `连接性 ${result.healthBreakdown.connectivity}% · 链接完整性 ${result.healthBreakdown.linkIntegrity}% · 内容完整性 ${result.healthBreakdown.contentCompleteness}%`,
		});

		const summary = this.contentEl.createDiv({ cls: 'agent-dashboard-check-summary' });
		this.createSummaryItem(summary, String(result.orphanNotes.length), '孤立笔记');
		this.createSummaryItem(summary, String(result.emptyNotes.length), '空笔记');
		this.createSummaryItem(summary, String(result.unresolvedLinkCount), '失效链接引用');
		this.createSummaryItem(summary, String(result.withoutFrontmatter.length), '无属性笔记');

		this.createPathSection('孤立笔记', '既没有指向其他笔记，也没有被其他笔记引用。', result.orphanNotes);
		this.createPathSection('空笔记', '文件中没有可见内容。', result.emptyNotes);
		this.createUnresolvedSection(result);
		this.createPathSection('无属性笔记', '没有 YAML properties；这不是错误，仅供整理参考。', result.withoutFrontmatter);
	}

	private createSummaryItem(container: HTMLElement, value: string, label: string): void {
		const item = container.createDiv();
		item.createEl('strong', { text: value });
		item.createSpan({ text: label });
	}

	private createPathSection(title: string, description: string, paths: string[]): void {
		const details = this.contentEl.createEl('details', { cls: 'agent-dashboard-check-section' });
		const summary = details.createEl('summary');
		summary.createSpan({ text: title });
		summary.createSpan({ cls: 'agent-dashboard-check-count', text: String(paths.length) });
		details.createEl('p', { text: description });
		if (!paths.length) {
			details.createEl('p', { cls: 'agent-dashboard-check-empty', text: '没有发现此类问题。' });
			return;
		}
		const list = details.createEl('ul');
		for (const path of paths.slice(0, 50)) {
			const item = list.createEl('li');
			const button = item.createEl('button', { text: path, attr: { type: 'button', title: '打开笔记' } });
			button.addEventListener('click', () => {
				void this.options.onOpenFile(path).catch((error: unknown) => {
					new Notice(error instanceof Error ? error.message : '打开笔记失败。');
				});
			});
		}
		if (paths.length > 50) list.createEl('li', { text: `另有 ${paths.length - 50} 项未展开显示。` });
	}

	private createUnresolvedSection(result: VaultCheckResult): void {
		const details = this.contentEl.createEl('details', { cls: 'agent-dashboard-check-section' });
		const summary = details.createEl('summary');
		summary.createSpan({ text: '未解析链接' });
		summary.createSpan({ cls: 'agent-dashboard-check-count', text: String(result.unresolvedLinks.length) });
		details.createEl('p', { text: '链接目标在当前知识库中不存在或无法解析。' });
		if (!result.unresolvedLinks.length) {
			details.createEl('p', { cls: 'agent-dashboard-check-empty', text: '所有内部链接都可以解析。' });
			return;
		}
		const list = details.createEl('ul');
		for (const link of result.unresolvedLinks.slice(0, 50)) {
			const item = list.createEl('li');
			item.createEl('code', { text: link.source });
			item.createSpan({ text: ` → ${link.target} ×${link.count}` });
		}
		if (result.unresolvedLinks.length > 50) {
			list.createEl('li', { text: `另有 ${result.unresolvedLinks.length - 50} 项未展开显示。` });
		}
	}
}
