import type { AiProfile, AiToolId } from './types';

export const DEFAULT_DEEP_RESEARCH_PROMPT = [
	'你正在 Xboard 的独立数据工作区中执行“深度研究”任务。',
	'请围绕用户的问题进行研究、核对和总结。如需获取外部信息，优先使用当前环境中已经安装的搜索 Skill 或工具。',
	'输出一份完整的中文 Markdown 文档，至少包含：结论、关键发现、依据或来源链接、仍需确认的问题。',
	'不要修改当前工作目录之外的任何文件。最终回复只输出 Markdown 正文。',
].join('\n');

export const CUSTOM_AI_ARGUMENT_PRESETS: Record<Exclude<AiToolId, 'codex'>, string> = {
	claude: ['-p', '{{prompt}}'].join('\n'),
	gemini: ['-p', '{{prompt}}'].join('\n'),
	opencode: ['run', '{{prompt}}'].join('\n'),
};

export const DEFAULT_CUSTOM_AI_ARGUMENTS = CUSTOM_AI_ARGUMENT_PRESETS.opencode;

export function createDefaultAiProfiles(): AiProfile[] {
	return [
		{
			id: 'quick-chat',
			name: '快速对话',
			tool: 'codex',
			executableMode: 'auto',
			executable: 'codex',
			customArguments: DEFAULT_CUSTOM_AI_ARGUMENTS,
			model: '',
			reasoningEffort: 'medium',
			networkAccess: false,
			readScope: 'none',
			readFolder: '',
			attachmentSupport: 'auto',
			permissionMode: 'xboard-only',
			timeoutMinutes: 20,
		},
		{
			id: 'deep-research',
			name: '深度研究',
			tool: 'codex',
			executableMode: 'auto',
			executable: 'codex',
			customArguments: DEFAULT_CUSTOM_AI_ARGUMENTS,
			model: '',
			reasoningEffort: 'high',
			networkAccess: true,
			readScope: 'none',
			readFolder: '',
			attachmentSupport: 'auto',
			permissionMode: 'xboard-only',
			timeoutMinutes: 45,
		},
	];
}

export function createBlankAiProfile(): AiProfile {
	const suffix = Date.now().toString(36);
	return {
		...createDefaultAiProfiles()[0]!,
		id: `ai-profile-${suffix}`,
		name: '新 AI 工作流任务模板',
	};
}

export function cloneAiProfile(profile: AiProfile): AiProfile {
	const suffix = Date.now().toString(36);
	return {
		...profile,
		id: `${profile.id}-copy-${suffix}`,
		name: `${profile.name}副本`,
	};
}

export function customAiArgumentsFor(tool: AiToolId): string {
	return tool === 'codex' ? DEFAULT_CUSTOM_AI_ARGUMENTS : CUSTOM_AI_ARGUMENT_PRESETS[tool];
}

export function isCustomAiArgumentPreset(value: string): boolean {
	return Object.values(CUSTOM_AI_ARGUMENT_PRESETS).includes(value);
}
