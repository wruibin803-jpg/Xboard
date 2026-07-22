export type DashboardCardSize = 'compact' | 'standard' | 'wide';

export type DashboardCardId =
	| 'health'
	| 'inbox'
	| 'task-flow'
	| 'inspiration'
	| 'brief'
	| 'tasks'
	| 'pomodoro'
	| 'heatmap'
	| 'calendar'
	| 'gallery'
	| 'github';

export type DashboardCardState<T> =
	| { kind: 'loading' }
	| { kind: 'ready'; data: T }
	| { kind: 'empty'; message: string }
	| { kind: 'error'; message: string };

export interface DashboardCardDefinition {
	id: DashboardCardId;
	title: string;
	icon: string;
	selector: string;
	defaultSize: DashboardCardSize;
	comingSoon?: boolean;
}

export interface DashboardCard<TData = unknown> {
	readonly definition: DashboardCardDefinition;
	mount(container: HTMLElement): void;
	refresh(): Promise<DashboardCardState<TData>>;
	destroy(): void;
}
