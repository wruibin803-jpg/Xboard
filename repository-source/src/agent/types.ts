import type { AgentDashboardSettings } from '../settings';

export type AgentTaskId = 'deep-research' | 'my-ai-chat' | 'conversation-summary';

export interface AgentTaskInput {
	content: string;
	titleHint: string;
}

export interface AgentTaskDefinition {
	id: AgentTaskId;
	name: string;
	buildTitle(input: AgentTaskInput): string;
	buildPrompt(input: AgentTaskInput, settings: AgentDashboardSettings): string;
}

export interface AgentProcessInput {
	executable: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
	onOutput?: (chunk: string) => void;
	onErrorOutput?: (chunk: string) => void;
}

export interface AgentProcessResult {
	stdout: string;
	stderr: string;
}
