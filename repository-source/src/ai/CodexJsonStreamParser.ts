import type { AiActivityListener } from './types';

type JsonRecord = Record<string, unknown>;

export class CodexJsonStreamParser {
	private buffer = '';
	private readonly messages: string[] = [];
	private failure = '';

	push(chunk: string, onActivity?: AiActivityListener): void {
		this.buffer += chunk;
		const lines = this.buffer.split(/\r?\n/);
		this.buffer = lines.pop() ?? '';
		for (const line of lines) this.consumeLine(line, onActivity);
	}

	finish(onActivity?: AiActivityListener): string {
		if (this.buffer.trim()) this.consumeLine(this.buffer, onActivity);
		this.buffer = '';
		if (this.failure && this.messages.length === 0) throw new Error(this.failure);
		return this.messages.join('\n\n').trim();
	}

	private consumeLine(line: string, onActivity?: AiActivityListener): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		let event: JsonRecord;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (!this.isRecord(parsed)) return;
			event = parsed;
		} catch {
			return;
		}
		const type = this.text(event.type);
		if (type === 'thread.started') {
			this.emit(onActivity, 'preparing', 'AI 进程已启动');
			return;
		}
		if (type === 'turn.started') {
			this.emit(onActivity, 'analysis', '正在分析你的任务');
			return;
		}
		if (type === 'turn.completed') {
			this.emit(onActivity, 'completed', '模型已完成本轮处理');
			return;
		}
		if (type === 'error') {
			const message = this.text(event.message);
			this.emit(onActivity, 'warning', '连接或模型服务正在重试', this.safeDetail(message));
			return;
		}
		if (type === 'turn.failed') {
			const error = this.isRecord(event.error) ? this.text(event.error.message) : '';
			this.failure = error || 'Codex 运行失败。';
			this.emit(onActivity, 'error', 'AI 任务运行失败', this.safeDetail(this.failure));
			return;
		}
		if (type !== 'item.started' && type !== 'item.completed') return;
		if (!this.isRecord(event.item)) return;
		this.consumeItem(event.item, type === 'item.completed', onActivity);
	}

	private consumeItem(
		item: JsonRecord,
		completed: boolean,
		onActivity?: AiActivityListener,
	): void {
		const type = this.text(item.type);
		if (type === 'agent_message') {
			const message = this.text(item.text);
			if (completed && message) this.messages.push(message);
			this.emit(
				onActivity,
				completed ? 'output' : 'analysis',
				completed ? '回答内容已生成' : '正在组织回答',
			);
			return;
		}
		if (type === 'reasoning') {
			this.emit(onActivity, 'analysis', '正在分析问题');
			return;
		}
		if (type === 'web_search') {
			this.emit(
				onActivity,
				'search',
				completed ? '外部信息搜索完成' : '正在搜索外部信息',
				this.safeDetail(this.text(item.query)),
			);
			return;
		}
		if (type === 'command_execution') {
			this.emit(
				onActivity,
				'command',
				completed ? '命令执行完成' : '正在执行命令',
				this.safeDetail(this.text(item.command)),
			);
			return;
		}
		if (type === 'mcp_tool_call') {
			const server = this.text(item.server);
			const tool = this.text(item.tool);
			this.emit(
				onActivity,
				'tool',
				completed ? '外部工具调用完成' : '正在调用外部工具',
				this.safeDetail([server, tool].filter(Boolean).join(' · ')),
			);
			return;
		}
		if (type === 'file_change') {
			this.emit(onActivity, 'tool', completed ? '结果文件已整理' : '正在整理结果文件');
			return;
		}
		if (type === 'todo_list') {
			this.emit(onActivity, 'analysis', completed ? '任务步骤已规划' : '正在规划任务步骤');
			return;
		}
		if (type === 'error') {
			const message = this.text(item.message);
			this.emit(onActivity, 'error', '工具报告错误', this.safeDetail(message));
			return;
		}
		this.emit(onActivity, 'tool', completed ? '一个处理步骤已完成' : '正在处理任务');
	}

	private emit(
		listener: AiActivityListener | undefined,
		kind: Parameters<AiActivityListener>[0]['kind'],
		label: string,
		detail?: string,
	): void {
		listener?.({
			kind,
			label,
			...(detail ? { detail } : {}),
			timestamp: Date.now(),
		});
	}

	private safeDetail(value: string): string {
		return value.replace(/\s+/g, ' ').trim().slice(0, 240);
	}

	private text(value: unknown): string {
		return typeof value === 'string' ? value : '';
	}

	private isRecord(value: unknown): value is JsonRecord {
		return typeof value === 'object' && value !== null;
	}
}
