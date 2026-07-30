import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type { AgentDashboardSettings } from '../settings';
import type { AiRunResult } from '../ai/types';
import { AiService } from '../services/AiService';

interface AiPublishModalOptions {
	result: AiRunResult;
	suggestedFileName: string;
	getSettings: () => AgentDashboardSettings;
	updateSettings: (settings: AgentDashboardSettings) => Promise<void>;
	service: AiService;
	onOpenFile: (file: TFile) => Promise<void>;
	onDecision: (decision: 'published' | 'kept') => void;
}

export class AiPublishModal extends Modal {
	private destinationFolder: string;
	private fileName: string;
	private decided = false;

	constructor(app: App, private readonly options: AiPublishModalOptions) {
		super(app);
		this.destinationFolder = options.getSettings().aiPublishFolder;
		this.fileName = options.suggestedFileName;
	}

	onOpen(): void {
		this.setTitle('AI 结果已生成');
		this.contentEl.addClass('agent-dashboard-ai-publish-modal');
		this.contentEl.createEl('p', {
			text: '结果已经安全保留在独立数据区。是否再复制一份到正式知识库？',
		});
		this.contentEl.createEl('code', {
			cls: 'agent-dashboard-ai-result-path',
			text: this.options.result.file.path,
		});
		new Setting(this.contentEl)
			.setName('正式保存目录')
			.setDesc('必须是已经存在的目录，并且不能位于独立数据区。')
			.addText((text) => text
				.setPlaceholder('例如：研究报告')
				.setValue(this.destinationFolder)
				.onChange((value) => {
					this.destinationFolder = value;
				}));
		new Setting(this.contentEl)
			.setName('文件名')
			.addText((text) => text
				.setValue(this.fileName)
				.onChange((value) => {
					this.fileName = value;
				}));
		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText('查看缓存结果')
				.onClick(async () => {
					await this.options.onOpenFile(this.options.result.file);
					this.finish('kept');
					this.close();
				}))
			.addButton((button) => button
				.setButtonText('暂不保存')
				.onClick(() => {
					this.finish('kept');
					this.close();
				}))
			.addButton((button) => button
				.setButtonText('保存到正式知识库')
				.setCta()
				.onClick(async () => {
					try {
						button.setDisabled(true).setButtonText('正在保存…');
						const file = await this.options.service.publishResult({
							source: this.options.result.file,
							destinationFolder: this.destinationFolder,
							fileName: this.fileName,
						});
						const settings = this.options.getSettings();
						await this.options.updateSettings({
							...settings,
							aiPublishFolder: this.destinationFolder.trim(),
						});
						new Notice(`已保存到 ${file.path}`);
						await this.options.onOpenFile(file);
						this.finish('published');
						this.close();
					} catch (error) {
						button.setDisabled(false).setButtonText('保存到正式知识库');
						new Notice(error instanceof Error ? error.message : '保存 AI 结果失败。');
					}
				}));
	}

	onClose(): void {
		this.finish('kept');
		this.contentEl.empty();
	}

	private finish(decision: 'published' | 'kept'): void {
		if (this.decided) return;
		this.decided = true;
		this.options.onDecision(decision);
	}
}
