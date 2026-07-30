import type {
	AiActivityEvent,
	AiActivityKind,
	AiWorkflowPhase,
} from '../ai/types';

const MAX_VISIBLE_EVENTS = 8;

export class AiActivityView {
	private readonly progressEl: HTMLElement;
	private readonly currentEl: HTMLElement;
	private readonly currentLabelEl: HTMLElement;
	private readonly currentDetailEl: HTMLElement;
	private readonly elapsedEl: HTMLElement;
	private readonly listEl: HTMLOListElement;
	private startedAt = 0;
	private intervalId: number | null = null;
	private lastEventKey = '';

	constructor(private readonly containerEl: HTMLElement) {
		const root = containerEl.createDiv({
			cls: 'agent-dashboard-ai-activity-view',
			attr: { 'aria-label': 'AI 实时任务状态' },
		});
		this.progressEl = root.createDiv({
			cls: 'agent-dashboard-ai-progress',
			attr: { 'aria-label': 'AI 任务进度' },
		});
		const current = root.createDiv({
			cls: 'agent-dashboard-ai-activity-current',
			attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
		});
		this.currentEl = current;
		const copy = current.createDiv();
		this.currentLabelEl = copy.createEl('strong', { text: '等待开始' });
		this.currentDetailEl = copy.createEl('p');
		this.currentDetailEl.hidden = true;
		this.elapsedEl = current.createEl('time', { text: '00:00' });
		this.listEl = root.createEl('ol', {
			cls: 'agent-dashboard-ai-activity-list',
			attr: { 'aria-label': '最近任务动态' },
		});
		this.renderProgress('preparing');
	}

	start(label = '正在准备任务'): void {
		this.stopClock();
		this.startedAt = Date.now();
		this.lastEventKey = '';
		this.listEl.empty();
		this.currentEl.dataset.kind = 'preparing';
		this.currentLabelEl.setText(label);
		this.currentDetailEl.hidden = true;
		this.currentDetailEl.setText('');
		this.renderProgress('preparing');
		this.updateElapsed();
		const viewWindow = this.containerEl.ownerDocument.defaultView;
		this.intervalId = viewWindow?.setInterval(() => this.updateElapsed(), 1000) ?? null;
	}

	update(activity: AiActivityEvent): void {
		const key = `${activity.kind}\n${activity.label}\n${activity.detail ?? ''}`;
		this.currentEl.dataset.kind = activity.kind;
		this.currentLabelEl.setText(activity.label);
		this.currentDetailEl.setText(activity.detail ?? '');
		this.currentDetailEl.hidden = !activity.detail;
		this.renderProgress(this.phaseForActivity(activity.kind));
		if (key === this.lastEventKey) return;
		this.lastEventKey = key;
		const item = this.listEl.createEl('li', {
			attr: { 'data-kind': activity.kind },
		});
		const copy = item.createDiv();
		copy.createEl('strong', { text: activity.label });
		if (activity.detail) copy.createEl('p', { text: activity.detail });
		item.createEl('time', {
			text: this.elapsedSinceStart(activity.timestamp),
			attr: { datetime: new Date(activity.timestamp).toISOString() },
		});
		while (this.listEl.children.length > MAX_VISIBLE_EVENTS) {
			this.listEl.firstElementChild?.remove();
		}
		this.listEl.scrollTop = this.listEl.scrollHeight;
	}

	report(kind: AiActivityKind, label: string, detail?: string): void {
		this.update({
			kind,
			label,
			...(detail ? { detail } : {}),
			timestamp: Date.now(),
		});
	}

	finish(
		phase: Extract<AiWorkflowPhase, 'waiting-confirmation' | 'completed' | 'failed' | 'cancelled'>,
		label: string,
		detail?: string,
	): void {
		const kind: AiActivityKind = phase === 'completed'
			? 'completed'
			: phase === 'failed'
				? 'error'
				: phase === 'cancelled' ? 'warning' : 'output';
		this.update({
			kind,
			label,
			...(detail ? { detail: detail.replace(/\s+/g, ' ').trim().slice(0, 500) } : {}),
			timestamp: Date.now(),
		});
		this.renderProgress(phase);
		this.stopClock();
	}

	destroy(): void {
		this.stopClock();
	}

	private renderProgress(phase: AiWorkflowPhase): void {
		const steps: Array<{ phase: AiWorkflowPhase; label: string }> = [
			{ phase: 'preparing', label: '准备材料' },
			{ phase: 'running', label: '模型处理中' },
			{ phase: 'waiting-confirmation', label: '等待确认' },
			{ phase: 'completed', label: '完成' },
		];
		const order = steps.map((step) => step.phase);
		const currentIndex = order.indexOf(phase);
		this.progressEl.empty();
		for (const [index, step] of steps.entries()) {
			const item = this.progressEl.createSpan({ text: step.label });
			if (phase === 'failed' || phase === 'cancelled') {
				if (index === 1) item.addClass(phase === 'failed' ? 'is-failed' : 'is-cancelled');
			} else if (index < currentIndex) {
				item.addClass('is-complete');
			} else if (index === currentIndex) {
				item.addClass('is-active');
			}
		}
	}

	private phaseForActivity(kind: AiActivityKind): AiWorkflowPhase {
		if (kind === 'preparing') return 'preparing';
		if (kind === 'completed') return 'completed';
		if (kind === 'error') return 'failed';
		return 'running';
	}

	private updateElapsed(): void {
		this.elapsedEl.setText(this.elapsedSinceStart(Date.now()));
	}

	private elapsedSinceStart(value: number): string {
		const elapsedSeconds = this.startedAt > 0
			? Math.max(0, Math.floor((value - this.startedAt) / 1000))
			: 0;
		const minutes = Math.floor(elapsedSeconds / 60);
		const seconds = elapsedSeconds % 60;
		return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	}

	private stopClock(): void {
		if (this.intervalId === null) return;
		this.containerEl.ownerDocument.defaultView?.clearInterval(this.intervalId);
		this.intervalId = null;
	}
}
