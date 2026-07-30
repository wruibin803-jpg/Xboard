import { App, Modal, Notice } from 'obsidian';
import type { AiTaskProposalItem } from '../ai/types';

interface AiTaskProposalModalOptions {
	tasks: AiTaskProposalItem[];
	onConfirm: (tasks: AiTaskProposalItem[]) => Promise<void>;
	onCancel: () => void;
}

export class AiTaskProposalModal extends Modal {
	private tasks: AiTaskProposalItem[];
	private confirmEl!: HTMLButtonElement;
	private saving = false;
	private decided = false;
	private domCleanups: Array<() => void> = [];

	constructor(app: App, private readonly options: AiTaskProposalModalOptions) {
		super(app);
		this.tasks = options.tasks.map((task) => ({ ...task }));
	}

	onOpen(): void {
		this.modalEl.addClass('agent-dashboard-ai-task-proposal-modal');
		this.titleEl.setText('确认添加任务');
		this.contentEl.createEl('p', {
			cls: 'agent-dashboard-modal-description',
			text: 'Xboard 只会在你确认后写入任务文件。AI 只负责提取，请检查任务和日期。',
		});
		const list = this.contentEl.createDiv({ cls: 'agent-dashboard-ai-task-proposal-list' });
		for (const [index, task] of this.tasks.entries()) this.renderTask(list, task, index);
		const actions = this.contentEl.createDiv({ cls: 'agent-dashboard-modal-actions' });
		const cancel = actions.createEl('button', { text: '取消', attr: { type: 'button' } });
		this.confirmEl = actions.createEl('button', {
			cls: 'mod-cta',
			text: `确认添加 ${this.tasks.length} 项`,
			attr: { type: 'button' },
		});
		this.registerDomEvent(cancel, 'click', () => this.close());
		this.registerDomEvent(this.confirmEl, 'click', () => void this.confirm());
		this.updateConfirmState();
	}

	onClose(): void {
		if (!this.decided) {
			this.decided = true;
			this.options.onCancel();
		}
		this.cleanupDomEvents();
		this.contentEl.empty();
	}

	private registerDomEvent<K extends keyof HTMLElementEventMap>(
		element: HTMLElement,
		type: K,
		handler: (event: HTMLElementEventMap[K]) => void,
	): void {
		element.addEventListener(type, handler);
		this.domCleanups.push(() => element.removeEventListener(type, handler));
	}

	private cleanupDomEvents(): void {
		for (const cleanup of this.domCleanups.splice(0)) cleanup();
	}

	private renderTask(container: HTMLElement, task: AiTaskProposalItem, index: number): void {
		const item = container.createDiv({ cls: 'agent-dashboard-ai-task-proposal-item' });
		item.createEl('strong', { text: `任务 ${index + 1}` });
		const title = item.createEl('input', {
			attr: {
				type: 'text',
				value: task.title,
				'aria-label': `任务 ${index + 1} 名称`,
			},
		});
		const fields = item.createDiv({ cls: 'agent-dashboard-ai-task-proposal-fields' });
		const date = fields.createEl('input', {
			attr: {
				type: 'date',
				value: task.dueDate,
				'aria-label': `${task.title}的日期`,
			},
		});
		const recurrence = fields.createEl('select', { attr: { 'aria-label': `${task.title}的重复方式` } });
		recurrence.createEl('option', { value: 'none', text: '不重复' });
		recurrence.createEl('option', { value: 'daily', text: '每天' });
		recurrence.createEl('option', { value: 'weekly', text: '每周' });
		recurrence.value = task.recurrence;
		const kind = fields.createEl('select', { attr: { 'aria-label': `${task.title}的类型` } });
		kind.createEl('option', { value: 'todo', text: '待办' });
		kind.createEl('option', { value: 'ddl', text: 'DDL' });
		kind.value = task.kind;
		const priority = fields.createEl('select', { attr: { 'aria-label': `${task.title}的优先级` } });
		priority.createEl('option', { value: 'high', text: '高优先级' });
		priority.createEl('option', { value: 'medium', text: '中优先级' });
		priority.createEl('option', { value: 'low', text: '低优先级' });
		priority.value = task.priority;
		const note = item.createEl('textarea', {
			attr: {
				rows: '2',
				placeholder: '备注或通知来源',
				'aria-label': `${task.title}的备注`,
			},
		});
		note.value = task.note;
		const warning = item.createEl('p', {
			cls: 'agent-dashboard-ai-task-proposal-warning',
			text: 'AI 无法确定时间，请在确认前选择日期。',
		});
		const updateWarning = (): void => {
			const uncertain = !task.dueDate || task.needsClarification;
			warning.hidden = !uncertain;
			item.classList.toggle('needs-clarification', uncertain);
			this.updateConfirmState();
		};
		this.registerDomEvent(title, 'input', () => {
			task.title = title.value.trim();
			this.updateConfirmState();
		});
		this.registerDomEvent(date, 'change', () => {
			task.dueDate = date.value;
			task.needsClarification = !date.value;
			updateWarning();
		});
		this.registerDomEvent(recurrence, 'change', () => {
			task.recurrence = recurrence.value === 'daily' || recurrence.value === 'weekly'
				? recurrence.value
				: 'none';
		});
		this.registerDomEvent(kind, 'change', () => {
			task.kind = kind.value === 'ddl' ? 'ddl' : 'todo';
		});
		this.registerDomEvent(priority, 'change', () => {
			task.priority = priority.value === 'high' || priority.value === 'low'
				? priority.value
				: 'medium';
		});
		this.registerDomEvent(note, 'input', () => {
			task.note = note.value.trim();
		});
		updateWarning();
	}

	private updateConfirmState(): void {
		if (!this.confirmEl) return;
		this.confirmEl.disabled = this.saving || this.tasks.some((task) => (
			!task.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) || task.needsClarification
		));
	}

	private async confirm(): Promise<void> {
		if (this.saving || this.confirmEl.disabled) return;
		this.saving = true;
		this.confirmEl.setText('正在添加…');
		this.updateConfirmState();
		try {
			await this.options.onConfirm(this.tasks.map((task) => ({ ...task })));
			this.decided = true;
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '添加任务失败。');
			this.saving = false;
			this.confirmEl.setText(`确认添加 ${this.tasks.length} 项`);
			this.updateConfirmState();
		}
	}
}
