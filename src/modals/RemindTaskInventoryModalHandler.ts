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

export class RemindTaskInventoryModalHandler extends BaseModalHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;
  private inventoryService: Pick<InventoryService, 'resolveByName'>;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager,
    inventoryService?: Pick<InventoryService, 'resolveByName'>
  ) {
    super('remind-task-inventory-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
    this.inventoryService = inventoryService || InventoryService.getInstance();
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
        inventoryItems = await Promise.all(parsedItems.map(async (item) => {
          const inventoryItem = await this.inventoryService.resolveByName(linkedInventoryChannelId, item.name);
          return {
            inventoryId: inventoryItem.id,
            consume: item.consume
          };
        }));
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

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length === 2 ? parts[1] : null;
  }
}
