import { App, Modal, Notice, Setting } from 'obsidian';
import {
	customAiArgumentsFor,
	isCustomAiArgumentPreset,
} from '../ai/defaults';
import type {
	AiExecutableMode,
	AiPermissionMode,
	AiProfile,
	AiReadScope,
	AiReasoningEffort,
	AiToolId,
} from '../ai/types';

interface AiProfileModalOptions {
	profile: AiProfile;
	onSave: (profile: AiProfile) => Promise<void>;
}

export class AiProfileModal extends Modal {
	private draft: AiProfile;
	private saving = false;
	private domCleanups: Array<() => void> = [];

	constructor(app: App, private readonly options: AiProfileModalOptions) {
		super(app);
		this.draft = { ...options.profile };
	}

	onOpen(): void {
		this.modalEl.addClass('agent-dashboard-ai-profile-modal');
		this.render();
	}

	onClose(): void {
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

	private render(): void {
		this.cleanupDomEvents();
		this.contentEl.empty();
		this.titleEl.setText('AI 工作流任务模板');

		new Setting(this.contentEl)
			.setName('任务模板名称')
			.setDesc('例如“快速对话”或“课程任务整理”。')
			.addText((text) => text
				.setValue(this.draft.name)
				.onChange((value) => {
					this.draft.name = value;
				}));

		new Setting(this.contentEl)
			.setName('使用哪个工具')
			.addDropdown((dropdown) => dropdown
				.addOption('codex', 'Codex')
				.addOption('claude', 'Claude')
				.addOption('gemini', 'Gemini')
				.addOption('opencode', 'Opencode')
				.setValue(this.draft.tool)
				.onChange((value) => {
					const tool = value as AiToolId;
					if (isCustomAiArgumentPreset(this.draft.customArguments)) {
						this.draft.customArguments = customAiArgumentsFor(tool);
					}
					this.draft.tool = tool;
					this.render();
				}));

		new Setting(this.contentEl)
			.setName('程序位置')
			.setDesc('优先使用自动查找；找不到时再手动填写。')
			.addDropdown((dropdown) => dropdown
				.addOption('auto', '自动查找')
				.addOption('manual', '手动指定')
				.setValue(this.draft.executableMode)
				.onChange((value) => {
					this.draft.executableMode = value as AiExecutableMode;
					this.render();
				}));

		if (this.draft.executableMode === 'manual') {
			new Setting(this.contentEl)
				.setName('程序完整位置')
				.addText((text) => text
					.setPlaceholder('例如 c:\\…\\codex.exe')
					.setValue(this.draft.executable)
					.onChange((value) => {
						this.draft.executable = value;
					}));
		}

		new Setting(this.contentEl)
			.setName('模型')
			.setDesc('可以留空，留空时使用该工具自己的默认模型。')
			.addText((text) => text
				.setPlaceholder('留空即可')
				.setValue(this.draft.model)
				.onChange((value) => {
					this.draft.model = value;
				}));

		new Setting(this.contentEl)
			.setName('思考强度')
			.setDesc(this.draft.tool === 'codex'
				? 'Codex 会按此强度运行；其他工具需在启动参数中使用 {{reasoning}}。'
				: '如果工具支持，请在启动参数中使用 {{reasoning}}。')
			.addDropdown((dropdown) => dropdown
				.addOption('low', '较快')
				.addOption('medium', '均衡')
				.addOption('high', '深入')
				.addOption('xhigh', '最深入')
				.setValue(this.draft.reasoningEffort)
				.onChange((value) => {
					this.draft.reasoningEffort = value as AiReasoningEffort;
				}));

		new Setting(this.contentEl)
			.setName('允许联网')
			.setDesc(this.draft.tool === 'codex'
				? '开启后允许 Codex 使用网页搜索。'
				: 'Xboard 会把该选择传给启动参数的 {{network}}；是否生效由工具决定。')
			.addToggle((toggle) => toggle
				.setValue(this.draft.networkAccess)
				.onChange((value) => {
					this.draft.networkAccess = value;
				}));

		new Setting(this.contentEl)
			.setName('允许读取的内容')
			.setDesc('Xboard 只提取选中的文字作为只读材料，不把正式知识库交给 AI 修改。')
			.addDropdown((dropdown) => dropdown
				.addOption('none', '不读取知识库')
				.addOption('active-note', '当前打开的笔记')
				.addOption('today', '今天修改的笔记')
				.addOption('folder', '指定文件夹')
				.setValue(this.draft.readScope)
				.onChange((value) => {
					this.draft.readScope = value as AiReadScope;
					this.render();
				}));

		if (this.draft.readScope === 'folder') {
			new Setting(this.contentEl)
				.setName('读取哪个文件夹')
				.setDesc('Vault 中已有文件夹的相对路径。')
				.addText((text) => text
					.setPlaceholder('例如 课程/机器人学')
					.setValue(this.draft.readFolder)
					.onChange((value) => {
						this.draft.readFolder = value;
					}));
		}

		new Setting(this.contentEl)
			.setName('文档和图片')
			.setDesc('如果你知道所选模型不支持附件，请选择“不支持”，发送时会提前提醒。')
			.addDropdown((dropdown) => dropdown
				.addOption('auto', '由工具判断')
				.addOption('supported', '支持')
				.addOption('unsupported', '不支持')
				.setValue(this.draft.attachmentSupport)
				.onChange((value) => {
					this.draft.attachmentSupport = value as AiProfile['attachmentSupport'];
				}));

		new Setting(this.contentEl)
			.setName('最长运行时间')
			.setDesc(`${this.draft.timeoutMinutes} 分钟`)
			.addSlider((slider) => slider
				.setLimits(1, 120, 1)
				.setDynamicTooltip()
				.setValue(this.draft.timeoutMinutes)
				.onChange((value) => {
					this.draft.timeoutMinutes = value;
				}));

		new Setting(this.contentEl)
			.setName('AI 可以操作的范围')
			.setDesc(this.draft.permissionMode === 'full-access'
				? '危险：工具可以绕过 Xboard 独立数据区。'
				: '推荐：只能写入本次 Xboard 工作目录。')
			.addDropdown((dropdown) => dropdown
				.addOption('xboard-only', '只允许独立数据区')
				.addOption('full-access', '最高权限（危险）')
				.setValue(this.draft.permissionMode)
				.onChange((value) => {
					this.draft.permissionMode = value as AiPermissionMode;
					this.render();
				}));

		if (this.draft.tool !== 'codex') {
			new Setting(this.contentEl)
				.setName('启动参数')
				.setDesc('每行一个参数。可使用 {{prompt}}、{{workdir}}、{{model}}、{{reasoning}} 和 {{network}}。')
				.addTextArea((text) => {
					text.setValue(this.draft.customArguments)
						.onChange((value) => {
							this.draft.customArguments = value;
						});
					text.inputEl.rows = 7;
				});
		}

		const actions = this.contentEl.createDiv({ cls: 'agent-dashboard-modal-actions' });
		const cancel = actions.createEl('button', { text: '取消', attr: { type: 'button' } });
		const save = actions.createEl('button', {
			cls: 'mod-cta',
			text: '保存任务模板',
			attr: { type: 'button' },
		});
		this.registerDomEvent(cancel, 'click', () => this.close());
		this.registerDomEvent(save, 'click', () => void this.save(save));
	}

	private cleanupDomEvents(): void {
		for (const cleanup of this.domCleanups.splice(0)) cleanup();
	}

	private async save(button: HTMLButtonElement): Promise<void> {
		if (this.saving) return;
		const name = this.draft.name.trim();
		if (!name) {
			new Notice('请填写任务模板名称。');
			return;
		}
		if (this.draft.executableMode === 'manual' && !this.draft.executable.trim()) {
			new Notice('请填写程序完整位置。');
			return;
		}
		if (this.draft.readScope === 'folder' && !this.draft.readFolder.trim()) {
			new Notice('请填写允许读取的文件夹。');
			return;
		}
		this.saving = true;
		button.disabled = true;
		button.setText('正在保存…');
		try {
			await this.options.onSave({
				...this.draft,
				name,
				executable: this.draft.executable.trim(),
				model: this.draft.model.trim(),
				readFolder: this.draft.readFolder.trim(),
			});
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '保存 AI 工作流任务模板失败。');
			this.saving = false;
			button.disabled = false;
			button.setText('保存任务模板');
		}
	}
}
