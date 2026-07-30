import { App, Modal, Notice, Setting } from 'obsidian';
import type { RssSubscription, RssTestResult } from '../rss/types';

interface RssSubscriptionModalOptions {
	subscription: RssSubscription;
	onSave: (subscription: RssSubscription) => Promise<void>;
	onTest: (subscription: RssSubscription) => Promise<RssTestResult>;
}

export class RssSubscriptionModal extends Modal {
	private readonly draft: RssSubscription;

	constructor(app: App, private readonly options: RssSubscriptionModalOptions) {
		super(app);
		this.draft = { ...options.subscription };
	}

	onOpen(): void {
		this.setTitle(this.options.subscription.url ? '编辑外部消息来源' : '添加外部消息来源');
		this.contentEl.addClass('agent-dashboard-settings-modal');

		new Setting(this.contentEl)
			.setName('显示名称')
			.setDesc('例如“少数派”或“AI 新闻”。')
			.addText((text) => text
				.setPlaceholder('给这个订阅起个容易认的名字')
				.setValue(this.draft.name)
				.onChange((value) => {
					this.draft.name = value;
				}));

		new Setting(this.contentEl)
			.setName('订阅地址')
			.setDesc('粘贴网站提供的订阅地址。')
			.addText((text) => text
				.setPlaceholder('https://example.com/feed.xml')
				.setValue(this.draft.url)
				.onChange((value) => {
					this.draft.url = value;
				}));

		new Setting(this.contentEl)
			.setName('分类')
			.setDesc('用于在仪表盘里筛选，例如“AI”“工作”“生活”。')
			.addText((text) => text
				.setPlaceholder('未分类')
				.setValue(this.draft.category)
				.onChange((value) => {
					this.draft.category = value;
				}));

		new Setting(this.contentEl)
			.setName('启用')
			.setDesc('关闭后，手动刷新时不会拉取这个订阅。')
			.addToggle((toggle) => toggle
				.setValue(this.draft.enabled)
				.onChange((value) => {
					this.draft.enabled = value;
				}));

		const result = this.contentEl.createEl('p', {
			cls: 'agent-dashboard-rss-test-result',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText('测试连接')
				.onClick(async () => {
					try {
						this.validate();
						button.setDisabled(true).setButtonText('正在测试…');
						const test = await this.options.onTest(this.normalizedDraft());
						result.setText(`连接成功：${test.feedTitle}，找到了 ${test.itemCount} 条内容。`);
						result.removeClass('is-error');
					} catch (error) {
						result.setText(error instanceof Error ? error.message : '连接测试失败。');
						result.addClass('is-error');
					} finally {
						button.setDisabled(false).setButtonText('测试连接');
					}
				}))
			.addButton((button) => button
				.setButtonText('取消')
				.onClick(() => this.close()))
			.addButton((button) => button
				.setButtonText('保存')
				.setCta()
				.onClick(async () => {
					try {
						this.validate();
						button.setDisabled(true);
						await this.options.onSave(this.normalizedDraft());
						this.close();
					} catch (error) {
						button.setDisabled(false);
						new Notice(error instanceof Error ? error.message : '保存订阅失败。');
					}
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private normalizedDraft(): RssSubscription {
		return {
			...this.draft,
			name: this.draft.name.trim(),
			url: this.draft.url.trim(),
			category: this.draft.category.trim() || '未分类',
		};
	}

	private validate(): void {
		if (!this.draft.name.trim()) throw new Error('请填写显示名称。');
		try {
			const url = new URL(this.draft.url.trim());
			if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
		} catch {
			throw new Error('请填写以 http:// 或 https:// 开头的订阅地址。');
		}
	}
}
