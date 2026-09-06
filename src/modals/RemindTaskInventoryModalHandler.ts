import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { parseInventoryInput } from '../utils/RemindInventory';
import type { RemindTask } from '../models/RemindTask';
import { InventoryRepository } from '../services/InventoryRepository';
import { InventoryMessageManager } from '../services/InventoryMessageManager';
import type { InventoryItem } from '../models/InventoryItem';
import { RemindTaskRefreshService } from '../services/RemindTaskRefreshService';

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
  private inventoryRepository: InventoryRepositoryPort;
  private inventoryMessageManager: InventoryMessageManagerPort;
  private refreshService: RefreshServicePort;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager,
    inventoryRepository?: InventoryRepositoryPort,
    inventoryMessageManager?: InventoryMessageManagerPort,
    refreshService?: RefreshServicePort
  ) {
    super('remind-task-inventory-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
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
    const expectedRevision = context.interaction.customId.split(':')[2];
    if (!expectedRevision) return { success: false, message: 'タスクが変更されました。開き直してください。' };
    task.revision = expectedRevision;


    const input = context.interaction.fields.getTextInputValue('inventory-items');
    let result: { task: RemindTask; inventoryChannelId: string | null; stockChanged: boolean };
    try {
      const items = parseInventoryInput(input);
      result = await this.repository.editInventorySettings(channelId, task, items);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '在庫の更新に失敗しました' };
    }
    if (result.stockChanged && result.inventoryChannelId) {
      await this.refreshInventoryMessage(result.inventoryChannelId, context.interaction.client);
      await this.refreshTasksUsingInventory(result.inventoryChannelId, context.interaction.client, messageId);
    }
    await this.messageManager.updateTaskMessage(channelId, messageId, result.task, context.interaction.client, new Date());

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
