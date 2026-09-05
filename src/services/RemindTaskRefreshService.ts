import { Client } from 'discord.js';
import { RemindChannelStore } from './RemindChannelStore';
import { RemindTaskRepository } from './RemindTaskRepository';
import { RemindMessageManager } from './RemindMessageManager';
import { Logger } from '../utils/logger';
import { LoggerManager } from '../utils/LoggerManager';
import type { RemindTask } from '../models/RemindTask';

export interface RefreshOptions {
  inventoryId?: string;
  excludeMessageId?: string;
}

export class RemindTaskRefreshService {
  private metadataManager: Pick<RemindChannelStore, 'findChannelsLinkedToInventory'>;
  private repository: Pick<RemindTaskRepository, 'fetchTasks' | 'referencingInventory'>;
  private messageManager: Pick<RemindMessageManager, 'updateTaskMessage'>;
  private logger: Logger;

  constructor(
    metadataManager?: Pick<RemindChannelStore, 'findChannelsLinkedToInventory'>,
    repository?: Pick<RemindTaskRepository, 'fetchTasks' | 'referencingInventory'>,
    messageManager?: Pick<RemindMessageManager, 'updateTaskMessage'>,
    logger?: Logger
  ) {
    this.metadataManager = metadataManager ?? RemindChannelStore.getInstance();
    this.repository = repository ?? new RemindTaskRepository();
    this.messageManager = messageManager ?? new RemindMessageManager();
    this.logger = logger ?? LoggerManager.getLogger('RemindTaskRefreshService');
  }

  public async refreshTasksUsingInventory(
    linkedInventoryChannelId: string,
    client: Client,
    options: RefreshOptions = {}
  ): Promise<void> {
    if (options.inventoryId) {
      const tasks = await this.repository.referencingInventory(linkedInventoryChannelId, options.inventoryId);
      for (const task of tasks) await this.refreshTask(task.channelId, task, client, options);
      return;
    }
    const channelIds = await this.metadataManager.findChannelsLinkedToInventory(linkedInventoryChannelId);
    for (const channelId of channelIds) {
      for (const task of await this.repository.fetchTasks(channelId)) {
        await this.refreshTask(channelId, task, client, options);
      }
    }
  }

  private async refreshTask(channelId: string, task: RemindTask, client: Client, options: RefreshOptions): Promise<void> {
    if (!task.messageId || task.messageId === options.excludeMessageId) return;
    try {
      await this.messageManager.updateTaskMessage(channelId, task.messageId, task, client, new Date());
    } catch (error) {
      this.logger.warn('Failed to refresh task message', {
        channelId, messageId: task.messageId, taskId: task.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
