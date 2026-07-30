import type { TFile } from 'obsidian';

export type AiProviderKind = 'codex-cli' | 'custom-cli';
export type AiPermissionMode = 'xboard-only' | 'full-access';
export type AiExecutableMode = 'auto' | 'manual';
export type AiToolId = 'codex' | 'claude' | 'gemini' | 'opencode';
export type AiReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type AiReadScope = 'none' | 'active-note' | 'today' | 'folder';
export type AiAttachmentSupport = 'auto' | 'supported' | 'unsupported';

export interface AiProfile {
	id: string;
	name: string;
	tool: AiToolId;
	executableMode: AiExecutableMode;
	executable: string;
	customArguments: string;
	model: string;
	reasoningEffort: AiReasoningEffort;
	networkAccess: boolean;
	readScope: AiReadScope;
	readFolder: string;
	attachmentSupport: AiAttachmentSupport;
	permissionMode: AiPermissionMode;
	timeoutMinutes: number;
}

export interface AiAttachmentInput {
	name: string;
	type: string;
	data: ArrayBuffer;
}

export interface AiTaskProposalItem {
	title: string;
	note: string;
	dueDate: string;
	kind: 'todo' | 'ddl';
	recurrence: 'none' | 'daily' | 'weekly';
	priority: 'high' | 'medium' | 'low';
	needsClarification: boolean;
}

export interface AiTaskProposal {
	type: 'create_tasks';
	tasks: AiTaskProposalItem[];
}

export type AiWorkflowPhase =
	| 'preparing'
	| 'running'
	| 'waiting-confirmation'
	| 'saving'
	| 'completed'
	| 'failed'
	| 'cancelled';

export interface AiWorkflowStatus {
	id: string;
	taskName: string;
	profileName: string;
	phase: AiWorkflowPhase;
	message: string;
	startedAt: number;
	updatedAt: number;
}

export type AiActivityKind =
	| 'preparing'
	| 'analysis'
	| 'search'
	| 'tool'
	| 'command'
	| 'output'
	| 'warning'
	| 'error'
	| 'completed';

export interface AiActivityEvent {
	kind: AiActivityKind;
	label: string;
	detail?: string;
	timestamp: number;
}

export type AiActivityListener = (activity: AiActivityEvent) => void;

export interface AiDetectedTool {
	id: AiToolId;
	name: string;
	path: string;
	prefixArguments?: string[];
}

export interface AiRunResult {
	file: TFile;
	content: string;
	durationMs: number;
	workflowId: string;
}

export interface AiConversationSession {
	workspacePath: string;
}

export interface AiConversationTurnResult {
	content: string;
	durationMs: number;
	workflowId: string;
}

export interface AiProviderTestResult {
	output: string;
	tool: AiDetectedTool | null;
}

export interface AiPublishInput {
	source: TFile;
	destinationFolder: string;
	fileName: string;
}
