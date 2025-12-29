import { Client } from 'discord.js';
import { RemindTask } from '../models/RemindTask';
import { RemindTaskFormatter } from '../ui/RemindTaskFormatter';
import { RemindMetadataManager } from './RemindMetadataManager';
import { RemindMessageManager } from './RemindMessageManager';
import { RemindSheetManager } from './RemindSheetManager';
import { RemindTaskRepository } from './RemindTaskRepository';

export interface RemindInitializationResult {
  success: boolean;
  message?: string;
}

export class RemindInitializationService {
  constructor(
    private sheetManager: RemindSheetManager = new RemindSheetManager(),
    private repository: RemindTaskRepository = new RemindTaskRepository(),
    private metadataManager: RemindMetadataManager = RemindMetadataManager.getInstance(),
    private messageManager: RemindMessageManager = new RemindMessageManager()
  ) {}

  public async initialize(
    channelId: string,
    client: Client,
    listTitle: string
  ): Promise<RemindInitializationResult> {
    await this.sheetManager.getOrCreateChannelSheet(channelId);

    const tasks = await this.repository.fetchTasks(channelId);
    for (const task of tasks) {
      await this.syncTaskMessage(channelId, task, client);
    }

    const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
    if (metadataResult.success) {
      await this.metadataManager.updateChannelMetadata(channelId, { listTitle });
    } else {
      await this.metadataManager.createChannelMetadata(channelId, '', listTitle);
    }

    return { success: true };
  }

  private async syncTaskMessage(channelId: string, task: RemindTask, client: Client): Promise<void> {
    const embed = RemindTaskFormatter.formatTaskEmbed(task);

    if (task.messageId) {
      const updateResult = await this.messageManager.updateTaskMessage(channelId, task.messageId, embed, client);
      if (updateResult.success) {
        return;
      }
    }

    const createResult = await this.messageManager.createTaskMessage(channelId, embed, client);
    if (createResult.success && createResult.messageId) {
      const updatedTask = {
        ...task,
        messageId: createResult.messageId,
        updatedAt: new Date()
      };
      await this.repository.updateTask(channelId, updatedTask);
    }
  }
}
