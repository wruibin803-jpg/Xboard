import { Platform } from 'obsidian';
import type { AiDetectedTool, AiProfile, AiToolId } from '../ai/types';

declare const require: (id: string) => unknown;

const AI_TOOLS: ReadonlyArray<{ id: AiToolId; name: string; command: string }> = [
	{ id: 'codex', name: 'Codex', command: 'codex' },
	{ id: 'claude', name: 'Claude', command: 'claude' },
	{ id: 'gemini', name: 'Gemini', command: 'gemini' },
	{ id: 'opencode', name: 'OpenCode', command: 'opencode' },
];

export interface ConfiguredAiTool {
	executable: string;
	prefixArguments: string[];
	tool: AiDetectedTool | null;
}

export class AiToolResolver {
	async detectTools(_force = false): Promise<AiDetectedTool[]> {
		this.requireDesktop();
		const node = this.loadDesktopModules();
		const results = await Promise.all(AI_TOOLS.map(async (tool): Promise<AiDetectedTool | null> => {
			const path = await this.findToolPath(tool.id, tool.command, node);
			if (path) return { id: tool.id, name: tool.name, path };
			return this.findNodeBackedTool(tool.id, tool.name, node);
		}));
		return results.filter((tool): tool is AiDetectedTool => tool !== null);
	}

	async getConfiguredTool(profile: AiProfile): Promise<ConfiguredAiTool> {
		if (profile.executableMode === 'manual') {
			return {
				executable: await this.resolveExecutable(profile.executable),
				prefixArguments: [],
				tool: null,
			};
		}
		const toolId = profile.tool;
		const tools = await this.detectTools();
		const tool = tools.find((candidate) => candidate.id === toolId);
		if (!tool) {
			const name = this.toolName(toolId);
			throw new Error(`没有自动找到 ${name}。请先确认它已安装，或在“程序位置”中改用手动选择。`);
		}
		return {
			executable: tool.path,
			prefixArguments: tool.prefixArguments ?? [],
			tool,
		};
	}

	async resolveExecutable(value: string): Promise<string> {
		const executable = value.trim();
		if (!executable) throw new Error('请先在设置中填写 AI 程序名称或路径。');
		if (/\.(cmd|bat|ps1)$/i.test(executable)) {
			throw new Error('为避免命令注入，请选择可执行文件（例如 codex.exe），不要选择 cmd、bat 或 ps1 脚本。');
		}
		if (!Platform.isWin || /[\\/]/.test(executable)) return executable;
		const node = this.loadDesktopModules();
		const pathValue = node.process.env.PATH ?? '';
		const candidates = executable.toLocaleLowerCase().endsWith('.exe')
			? [executable]
			: [`${executable}.exe`];
		for (const directory of pathValue.split(node.path.delimiter).filter(Boolean)) {
			for (const candidate of candidates) {
				const path = node.path.join(directory, candidate);
				try {
					await node.fileSystem.access(path);
					return path;
				} catch {
					// Continue through PATH candidates.
				}
			}
		}
		return executable;
	}

	private async findNodeBackedTool(
		id: AiToolId,
		name: string,
		node: Awaited<ReturnType<AiToolResolver['loadDesktopModules']>>,
	): Promise<AiDetectedTool | null> {
		if (!Platform.isWin) return null;
		const nodePath = await this.findExecutableInPath('node.exe', node);
		if (!nodePath) return null;
		const npmModules = node.path.join(this.windowsAppData(node), 'npm', 'node_modules');
		const entrypoints: Partial<Record<AiToolId, string[]>> = {
			codex: [
				node.path.join(npmModules, '@openai', 'codex', 'bin', 'codex.js'),
			],
			claude: [
				node.path.join(npmModules, '@anthropic-ai', 'claude-code', 'cli-wrapper.cjs'),
				node.path.join(npmModules, '@anthropic-ai', 'claude-code', 'cli.js'),
			],
			gemini: [
				node.path.join(npmModules, '@google', 'gemini-cli', 'dist', 'index.js'),
			],
		};
		for (const entrypoint of entrypoints[id] ?? []) {
			try {
				if ((await node.fileSystem.stat(entrypoint)).isFile()) {
					return { id, name, path: nodePath, prefixArguments: [entrypoint] };
				}
			} catch {
				// Continue through the known package entry points.
			}
		}
		return null;
	}

	private async findExecutableInPath(
		fileName: string,
		node: Awaited<ReturnType<AiToolResolver['loadDesktopModules']>>,
	): Promise<string | null> {
		const environment = node.process.env;
		const directories = [
			...(environment.PATH ?? '').split(node.path.delimiter),
			environment.ProgramFiles && node.path.join(environment.ProgramFiles, 'nodejs'),
			node.path.join(this.windowsLocalAppData(node), 'Programs', 'nodejs'),
		].filter((directory): directory is string => Boolean(directory));
		for (const directory of directories) {
			const candidate = node.path.join(directory.trim().replace(/^"(.*)"$/, '$1'), fileName);
			try {
				if ((await node.fileSystem.stat(candidate)).isFile()) return candidate;
			} catch {
				// Continue through PATH entries.
			}
		}
		return null;
	}

	private async findToolPath(
		id: AiToolId,
		command: string,
		node: Awaited<ReturnType<AiToolResolver['loadDesktopModules']>>,
	): Promise<string | null> {
		const environment = node.process.env;
		const home = this.userHome(node);
		const appData = this.windowsAppData(node);
		const localAppData = this.windowsLocalAppData(node);
		const pathDirectories = (environment.PATH ?? '')
			.split(node.path.delimiter)
			.map((directory) => directory.trim().replace(/^"(.*)"$/, '$1'))
			.filter(Boolean);
		const commonDirectories = [
			home && node.path.join(home, '.local', 'bin'),
			home && node.path.join(home, 'bin'),
			node.path.join(localAppData, 'Microsoft', 'WindowsApps'),
			node.path.join(appData, 'npm'),
			environment.ProgramFiles && node.path.join(environment.ProgramFiles, command),
			environment['ProgramFiles(x86)'] && node.path.join(environment['ProgramFiles(x86)'], command),
			...pathDirectories,
		].filter((directory): directory is string => Boolean(directory));
		const fileName = Platform.isWin ? `${command}.exe` : command;
		const candidates = [
			...this.knownToolPaths(id, node),
			...commonDirectories.map((directory) => node.path.join(directory, fileName)),
		];
		const seen = new Set<string>();
		for (const candidate of candidates) {
			const key = Platform.isWin ? candidate.toLocaleLowerCase() : candidate;
			if (seen.has(key)) continue;
			seen.add(key);
			try {
				if ((await node.fileSystem.stat(candidate)).isFile()) return candidate;
			} catch {
				// Missing and inaccessible candidates are expected during detection.
			}
		}
		return null;
	}

	private knownToolPaths(
		id: AiToolId,
		node: Awaited<ReturnType<AiToolResolver['loadDesktopModules']>>,
	): string[] {
		const home = this.userHome(node);
		if (!home) return [];
		if (!Platform.isWin) {
			return [
				node.path.join(home, '.local', 'bin', id),
				node.path.join('/usr/local/bin', id),
				node.path.join('/opt/homebrew/bin', id),
			];
		}
		if (id === 'codex') {
			const npmRoot = node.path.join(
				this.windowsAppData(node),
				'npm',
				'node_modules',
				'@openai',
				'codex',
				'node_modules',
			);
			return [
				node.path.join(this.windowsLocalAppData(node), 'Programs', 'Codex', 'codex.exe'),
				node.path.join(npmRoot, '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
				node.path.join(npmRoot, '@openai', 'codex-win32-arm64', 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe'),
			];
		}
		if (id === 'claude') {
			return [
				node.path.join(home, '.claude', 'local', 'claude.exe'),
				node.path.join(home, '.local', 'bin', 'claude.exe'),
				node.path.join(this.windowsLocalAppData(node), 'Programs', 'Claude', 'claude.exe'),
			];
		}
		if (id === 'opencode') {
			return [
				node.path.join(home, '.opencode', 'bin', 'opencode.exe'),
				node.path.join(home, '.local', 'bin', 'opencode.exe'),
			];
		}
		return [node.path.join(home, '.local', 'bin', 'gemini.exe')];
	}

	private userHome(node: Awaited<ReturnType<AiToolResolver['loadDesktopModules']>>): string {
		return node.process.env.USERPROFILE
			?? node.process.env.HOME
			?? node.operatingSystem.homedir();
	}

	private windowsAppData(node: Awaited<ReturnType<AiToolResolver['loadDesktopModules']>>): string {
		return node.process.env.APPDATA
			?? node.path.join(this.userHome(node), 'AppData', 'Roaming');
	}

	private windowsLocalAppData(node: Awaited<ReturnType<AiToolResolver['loadDesktopModules']>>): string {
		return node.process.env.LOCALAPPDATA
			?? node.path.join(this.userHome(node), 'AppData', 'Local');
	}

	private toolName(id: AiToolId): string {
		return AI_TOOLS.find((tool) => tool.id === id)?.name ?? id;
	}

	private loadDesktopModules() {
		if (Platform.isDesktop) {
			return {
				// Obsidian executes desktop plugins through CommonJS and cannot dynamically import Node built-ins.
				fileSystem: require('node:fs/promises') as typeof import('node:fs/promises'),
				operatingSystem: require('node:os') as typeof import('node:os'),
				path: require('node:path') as typeof import('node:path'),
				process: require('node:process') as typeof import('node:process'),
			};
		}
		throw new Error('本地 AI 工具只能在桌面版 Obsidian 中运行。');
	}

	private requireDesktop(): void {
		if (!Platform.isDesktop) throw new Error('本地 AI 工具只能在桌面版 Obsidian 中运行。');
	}
}
