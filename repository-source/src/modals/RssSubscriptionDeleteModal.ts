import { App, Modal, Setting } from 'obsidian';
import type { RssSubscription } from '../rss/types';

interface RssSubscriptionDeleteModalOptions {
	subscription: RssSubscription;
	onConfirm: () => Promise<void>;
}

export class RssSubscriptionDeleteModal extends Modal {
	constructor(app: App, private readonly options: RssSubscriptionDeleteModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('移除外部消息来源');
		this.contentEl.createEl('p', {
			text: `确定移除“${this.options.subscription.name}”吗？已有缓存不会立刻删除，下次手动刷新时会自动整理。`,
		});
		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText('取消')
				.onClick(() => this.close()))
			.addButton((button) => button
				.setButtonText('移除')
				.setWarning()
				.onClick(async () => {
					button.setDisabled(true);
					await this.options.onConfirm();
					this.close();
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
