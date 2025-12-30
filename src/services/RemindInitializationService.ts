import { Client } from 'discord.js';
import { RemindTask } from '../models/RemindTask';
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

    const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
    if (metadataResult.success) {
      await this.metadataManager.updateChannelMetadata(channelId, { listTitle });
    } else {
      await this.metadataManager.createChannelMetadata(channelId, '', listTitle);
    }

    const refreshedMetadata = await this.metadataManager.getChannelMetadata(channelId);
    const threadResult = await this.messageManager.ensureReminderThread(
      channelId,
      client,
      refreshedMetadata.metadata?.remindNoticeThreadId,
      refreshedMetadata.metadata?.remindNoticeMessageId
    );
    if (threadResult.success && threadResult.threadId && threadResult.parentMessageId) {
      await this.metadataManager.updateChannelMetadata(channelId, {
        remindNoticeThreadId: threadResult.threadId,
        remindNoticeMessageId: threadResult.parentMessageId
      });
    }

    const tasks = await this.repository.fetchTasks(channelId);
    for (const task of tasks) {
      const syncResult = await this.syncTaskMessage(channelId, task, client);
      if (!syncResult.success) {
        return { success: false, message: syncResult.message };
      }
    }

    return { success: true };
  }

  private async syncTaskMessage(channelId: string, task: RemindTask, client: Client): Promise<{ success: boolean; message?: string }> {
    if (task.messageId) {
      try {
        const updateResult = await this.messageManager.updateTaskMessage(channelId, task.messageId, task, client);
        if (updateResult.success) {
          return { success: true };
        }
      } catch {
        // fall through to recreate message
      }
    }

    const createResult = await this.messageManager.createTaskMessage(channelId, task, client);
    if (createResult.success && createResult.messageId) {
      const updatedTask = {
        ...task,
        messageId: createResult.messageId,
        updatedAt: new Date()
      };
      const updateResult = await this.repository.updateTask(channelId, updatedTask);
      if (!updateResult.success) {
        return { success: false, message: updateResult.message };
      }
      return { success: true };
    }
    return { success: false, message: createResult.message };
  }
}
