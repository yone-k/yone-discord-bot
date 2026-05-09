import { Client } from 'discord.js';
import { RemindMetadataManager } from './RemindMetadataManager';
import { RemindTaskRepository } from './RemindTaskRepository';
import { RemindMessageManager } from './RemindMessageManager';
import { isNewInventoryItem } from '../models/RemindTask';
import { Logger } from '../utils/logger';
import { LoggerManager } from '../utils/LoggerManager';

export interface RefreshOptions {
  inventoryId?: string;
  excludeMessageId?: string;
}

export class RemindTaskRefreshService {
  private metadataManager: Pick<RemindMetadataManager, 'findChannelsLinkedToInventory'>;
  private repository: Pick<RemindTaskRepository, 'fetchTasks'>;
  private messageManager: Pick<RemindMessageManager, 'updateTaskMessage'>;
  private logger: Logger;

  constructor(
    metadataManager?: Pick<RemindMetadataManager, 'findChannelsLinkedToInventory'>,
    repository?: Pick<RemindTaskRepository, 'fetchTasks'>,
    messageManager?: Pick<RemindMessageManager, 'updateTaskMessage'>,
    logger?: Logger
  ) {
    this.metadataManager = metadataManager ?? RemindMetadataManager.getInstance();
    this.repository = repository ?? new RemindTaskRepository();
    this.messageManager = messageManager ?? new RemindMessageManager();
    this.logger = logger ?? LoggerManager.getLogger('RemindTaskRefreshService');
  }

  public async refreshTasksUsingInventory(
    linkedInventoryChannelId: string,
    client: Client,
    options: RefreshOptions = {}
  ): Promise<void> {
    const taskChannelIds = await this.metadataManager.findChannelsLinkedToInventory(linkedInventoryChannelId);
    for (const channelId of taskChannelIds) {
      const tasks = await this.repository.fetchTasks(channelId);
      for (const task of tasks) {
        if (!task.messageId) continue;
        if (options.excludeMessageId && task.messageId === options.excludeMessageId) continue;
        if (options.inventoryId) {
          const usesInventoryId = task.inventoryItems.some(item => (
            isNewInventoryItem(item) && item.inventoryId === options.inventoryId
          ));
          if (!usesInventoryId) continue;
        }
        try {
          await this.messageManager.updateTaskMessage(channelId, task.messageId, task, client, new Date());
        } catch (error) {
          this.logger.warn('Failed to refresh task message', {
            channelId,
            messageId: task.messageId,
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
  }
}
