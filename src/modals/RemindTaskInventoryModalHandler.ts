import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { parseInventoryInput } from '../utils/RemindInventory';
import type { RemindTask } from '../models/RemindTask';

export class RemindTaskInventoryModalHandler extends BaseModalHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager
  ) {
    super('remind-task-inventory-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
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
        inventoryItems = parseInventoryInput(input);
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
