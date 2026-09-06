import { Client, RESTJSONErrorCodes } from 'discord.js';
import { RemindTask } from '../models/RemindTask';
import { RemindChannelStore } from './RemindChannelStore';
import { RemindMessageManager } from './RemindMessageManager';
import { RemindTaskRepository } from './RemindTaskRepository';

export interface RemindInitializationResult {
  success: boolean;
  message?: string;
}

export class RemindInitializationService {
  constructor(
    private repository: RemindTaskRepository = new RemindTaskRepository(),
    private metadataManager: RemindChannelStore = RemindChannelStore.getInstance(),
    private messageManager: RemindMessageManager = new RemindMessageManager()
  ) {}

  public async initialize(
    channelId: string,
    client: Client,
    listTitle: string
  ): Promise<RemindInitializationResult> {
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
    if (!threadResult.success || !threadResult.threadId || !threadResult.parentMessageId) {
      return { success: false, message: threadResult.message || '通知スレッドを準備できませんでした' };
    }
    await this.metadataManager.updateChannelMetadata(channelId, {
      remindNoticeThreadId: threadResult.threadId,
      remindNoticeMessageId: threadResult.parentMessageId
    });

    const tasks = await this.repository.fetchTasks(channelId);
    for (const task of tasks) {
      const syncResult = await this.syncTaskMessage(channelId, task, client);
      if (!syncResult.success) {
        return { success: false, message: syncResult.message };
      }
    }

    return { success: true };
  }

  public async syncTaskMessage(channelId: string, task: RemindTask, client: Client): Promise<{ success: boolean; message?: string }> {
    if (task.messageId) {
      try {
        const updateResult = await this.messageManager.updateTaskMessage(channelId, task.messageId, task, client);
        return updateResult;
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== RESTJSONErrorCodes.UnknownMessage) throw error;
      }
    }

    const createResult = await this.messageManager.createTaskMessage(channelId, task, client);
    if (createResult.success && createResult.messageId) {
      // Persistence errors reject initialization; the caller keeps readiness false.
      await this.repository.patchTask(channelId, task, { messageId: createResult.messageId });
      return { success: true };
    }
    return { success: false, message: createResult.message };
  }
}
