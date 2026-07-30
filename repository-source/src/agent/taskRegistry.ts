import type { AgentTaskDefinition, AgentTaskId } from './types';

const DEEP_RESEARCH_TASK: AgentTaskDefinition = {
	id: 'deep-research',
	name: '深度研究',
	buildTitle: (input) => `深度研究 ${input.titleHint.slice(0, 36)}`,
	buildPrompt: (input, settings) => [
		settings.deepResearchPrompt,
		'',
		'下面是当前对话。回答最后一个用户问题，并结合前文保持上下文连贯：',
		'',
		input.content,
	].join('\n'),
};

const MY_AI_CHAT_TASK: AgentTaskDefinition = {
	id: 'my-ai-chat',
	name: 'AI 临时对话',
	buildTitle: () => 'AI 临时对话',
	buildPrompt: (input) => [
		'你是用户的个人 AI 助手。请直接回答最后一个用户问题，并结合前文保持上下文连贯。',
		'本次对话不会自动保存。不要创建、修改或删除任何文件。',
		`今天是 ${new Date().toLocaleDateString('sv-SE')}。`,
		'如果用户要求添加待办，或粘贴通知并希望提取任务，请先用自然语言简要说明你识别到的内容，再在回复末尾输出一个任务提案。',
		'任务提案必须严格使用以下格式，标签外不要再输出 JSON：',
		'<XBOARD_TASK_PROPOSAL>{"type":"create_tasks","tasks":[{"title":"任务名称","note":"来源或补充说明","dueDate":"YYYY-MM-DD","kind":"todo","recurrence":"none","priority":"medium","needsClarification":false}]}</XBOARD_TASK_PROPOSAL>',
		'kind 只能是 todo 或 ddl；recurrence 只能是 none、daily、weekly；priority 只能是 high、medium、low。',
		'“每天”使用 daily，“每周”使用 weekly。一次性任务使用 none。明确截止时间的任务优先使用 ddl。',
		'将“明天、下周一”等相对日期换算成 YYYY-MM-DD；如果时间无法确定，dueDate 使用空字符串并把 needsClarification 设为 true，绝对不要猜测。',
		'任务提案只是等待用户确认的建议，不代表已经写入任务。',
		'',
		input.content,
	].join('\n'),
};

const CONVERSATION_SUMMARY_TASK: AgentTaskDefinition = {
	id: 'conversation-summary',
	name: '对话总结',
	buildTitle: (input) => `对话总结 ${input.titleHint.slice(0, 36)}`,
	buildPrompt: (input) => [
		'请把下面这次对话整理成一份可以长期回顾的中文 Markdown 总结。',
		'保留真正有用的信息，不要逐句复述。至少包含：讨论主题、重要结论、行动清单、值得保留的经验、尚未解决的问题。',
		'最终只输出 Markdown 正文。',
		'',
		input.content,
	].join('\n'),
};

const AGENT_TASKS: ReadonlyMap<AgentTaskId, AgentTaskDefinition> = new Map([
	[DEEP_RESEARCH_TASK.id, DEEP_RESEARCH_TASK],
	[MY_AI_CHAT_TASK.id, MY_AI_CHAT_TASK],
	[CONVERSATION_SUMMARY_TASK.id, CONVERSATION_SUMMARY_TASK],
]);

export function getAgentTask(taskId: AgentTaskId): AgentTaskDefinition {
	const task = AGENT_TASKS.get(taskId);
	if (!task) throw new Error(`找不到 AI 任务模板“${taskId}”。`);
	return task;
}
