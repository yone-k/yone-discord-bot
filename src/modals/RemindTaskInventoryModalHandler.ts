import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { parseInventoryInput } from '../utils/RemindInventory';
import type { RemindTask } from '../models/RemindTask';
import { InventoryService } from '../services/InventoryService';
import { InventoryRepository } from '../services/InventoryRepository';
import { InventoryMessageManager } from '../services/InventoryMessageManager';
import type { InventoryItem } from '../models/InventoryItem';
import { RemindTaskRefreshService } from '../services/RemindTaskRefreshService';

interface InventoryServicePort {
  resolveByName(channelId: string, name: string): Promise<InventoryItem>;
  update(channelId: string, item: InventoryItem): Promise<{ success: boolean; message?: string }>;
  getById(channelId: string, id: string): Promise<InventoryItem | null>;
}

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

interface InventoryMessageManagerPort {
  createOrUpdateMessage(
    channelId: string,
    items: InventoryItem[],
    listTitle: string,
    client: ModalHandlerContext['interaction']['client']
  ): Promise<{ success: boolean; errorMessage?: string }>;
}

interface RefreshServicePort {
  refreshTasksUsingInventory(
    linkedInventoryChannelId: string,
    client: ModalHandlerContext['interaction']['client'],
    options?: { excludeMessageId?: string }
  ): Promise<void>;
}

export class RemindTaskInventoryModalHandler extends BaseModalHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;
  private inventoryService: InventoryServicePort;
  private inventoryRepository: InventoryRepositoryPort;
  private inventoryMessageManager: InventoryMessageManagerPort;
  private refreshService: RefreshServicePort;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager,
    inventoryService?: InventoryServicePort,
    inventoryRepository?: InventoryRepositoryPort,
    inventoryMessageManager?: InventoryMessageManagerPort,
    refreshService?: RefreshServicePort
  ) {
    super('remind-task-inventory-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
    this.inventoryService = inventoryService || InventoryService.getInstance();
    this.inventoryRepository = inventoryRepository || new InventoryRepository();
    this.inventoryMessageManager = inventoryMessageManager || InventoryMessageManager.getInstance();
    this.refreshService = refreshService || new RemindTaskRefreshService();
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId.startsWith('remind-task-inventory-modal:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: '在庫設定'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ 在庫を更新しました。';
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const messageId = this.parseMessageId(context.interaction.customId);
    if (!channelId || !messageId) {
      return { success: false, message: 'チャンネル情報が取得できません' };
    }

    const task = await this.repository.findTaskByMessageId(channelId, messageId);
    if (!task) {
      return { success: false, message: 'タスクが見つかりません' };
    }

    const input = context.interaction.fields.getTextInputValue('inventory-items').trim();
    let inventoryItems: RemindTask['inventoryItems'] = [];
    if (input !== '') {
      try {
        if (!this.metadataManager) {
          return { success: false, message: '在庫チャンネルが連携されていません' };
        }
        const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
        const linkedInventoryChannelId = (metadataResult.metadata as { linkedInventoryChannelId?: string } | undefined)
          ?.linkedInventoryChannelId;
        if (!linkedInventoryChannelId) {
          return { success: false, message: '在庫チャンネルが連携されていません' };
        }
        const parsedItems = parseInventoryInput(input);

        let stockUpdated = false;
        inventoryItems = [];
        for (const item of parsedItems) {
          const inventoryItem = await this.inventoryService.resolveByName(linkedInventoryChannelId, item.name);
          if (item.stock !== undefined) {
            const updateResult = await this.inventoryService.update(linkedInventoryChannelId, {
              ...inventoryItem,
              stock: item.stock
            });
            if (!updateResult.success) {
              throw new Error(updateResult.message ?? '在庫の更新に失敗しました');
            }
            stockUpdated = true;
          }
          inventoryItems.push({
            inventoryId: inventoryItem.id,
            consume: item.consume
          });
        }
        if (stockUpdated) {
          await this.refreshInventoryMessage(linkedInventoryChannelId, context.interaction.client);
          await this.refreshTasksUsingInventory(linkedInventoryChannelId, context.interaction.client, messageId);
        }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : '在庫の形式が無効です' };
      }
    }

    const now = new Date();
    const updatedTask = {
      ...task,
      inventoryItems,
      updatedAt: now
    };

    const updateResult = await this.repository.updateTask(channelId, updatedTask);
    if (!updateResult.success) {
      return { success: false, message: updateResult.message };
    }

    await this.messageManager.updateTaskMessage(channelId, messageId, updatedTask, context.interaction.client, now);

    return { success: true };
  }

  private async refreshInventoryMessage(
    channelId: string,
    client: ModalHandlerContext['interaction']['client']
  ): Promise<void> {
    try {
      const items = await this.inventoryRepository.fetchAll(channelId);
      const result = await this.inventoryMessageManager.createOrUpdateMessage(channelId, items, '在庫リスト', client);
      if (!result.success) {
        this.logger.warn('Failed to refresh inventory message after task inventory update', {
          channelId,
          error: result.errorMessage
        });
      }
    } catch (error) {
      this.logger.warn('Failed to refresh inventory message after task inventory update', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async refreshTasksUsingInventory(
    linkedInventoryChannelId: string,
    client: ModalHandlerContext['interaction']['client'],
    messageId: string
  ): Promise<void> {
    try {
      await this.refreshService.refreshTasksUsingInventory(linkedInventoryChannelId, client, {
        excludeMessageId: messageId
      });
    } catch (error) {
      this.logger.warn('Failed to refresh task messages after task inventory update', {
        linkedInventoryChannelId,
        messageId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length >= 2 && parts[1] ? parts[1] : null;
  }
}
