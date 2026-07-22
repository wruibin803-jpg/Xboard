import type { App, TFile } from 'obsidian';
import type { CaptureInput } from './DashboardVaultService';
import type {
	DashboardTask,
	DashboardTaskInput,
	DashboardTaskMove,
} from './DashboardTaskService';
import { DashboardTaskService } from './DashboardTaskService';
import { DashboardVaultService } from './DashboardVaultService';

export class DashboardActions {
	constructor(
		private readonly app: App,
		private readonly vaultService: DashboardVaultService,
		private readonly taskService: DashboardTaskService,
	) {}

	async openFile(path: string): Promise<void> {
		await this.app.workspace.openLinkText(path, '', false);
	}

	async createCapture(input: CaptureInput): Promise<TFile> {
		const file = await this.vaultService.createCapture(input);
		await this.app.workspace.getLeaf('tab').openFile(file);
		return file;
	}

	async saveInspiration(content: string): Promise<TFile> {
		return this.vaultService.saveInspiration(content);
	}

	async createTask(input: DashboardTaskInput): Promise<DashboardTask> {
		return this.taskService.addTask(input);
	}

	async setTaskCompleted(id: string, completed: boolean): Promise<void> {
		await this.taskService.setCompleted(id, completed);
	}

	async deleteTask(id: string): Promise<void> {
		await this.taskService.deleteTask(id);
	}

	async moveTask(id: string, move: DashboardTaskMove): Promise<void> {
		await this.taskService.moveTask(id, move);
	}
}
