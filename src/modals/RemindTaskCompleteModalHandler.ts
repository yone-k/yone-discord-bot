import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { calculateNextDueAt } from '../utils/RemindSchedule';
import {
  consumeInventory,
  formatInventoryDepleted,
  formatInventoryShortage,
  getInsufficientInventoryItems
} from '../utils/RemindInventory';

export class RemindTaskCompleteModalHandler extends BaseModalHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager
  ) {
    super('remind-task-complete-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId.startsWith('remind-task-complete-modal:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'complete',
      actionName: 'リマインド完了'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ 完了として登録しました。';
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

    const insufficientItems = getInsufficientInventoryItems(task.inventoryItems);
    if (insufficientItems.length > 0) {
      await this.notifyInventory(
        channelId,
        `@everyone ${task.title}の在庫が不足しています: ${formatInventoryShortage(insufficientItems)}`,
        context.interaction.client
      );
      return { success: false, message: `在庫が不足しています: ${formatInventoryShortage(insufficientItems)}` };
    }

    const consumedInventory = consumeInventory(task.inventoryItems);
    const depletedItems = consumedInventory.filter(item => item.stock <= 0);

    const now = new Date();
    const nextDueAt = calculateNextDueAt(
      {
        intervalDays: task.intervalDays,
        timeOfDay: task.timeOfDay,
        startAt: task.startAt,
        lastDoneAt: now
      },
      now
    );

    const updatedTask = {
      ...task,
      inventoryItems: consumedInventory,
      lastDoneAt: now,
      nextDueAt,
      lastRemindDueAt: null,
      overdueNotifyCount: 0,
      lastOverdueNotifiedAt: null,
      updatedAt: now
    };

    const updateResult = await this.repository.updateTask(channelId, updatedTask);
    if (!updateResult.success) {
      return { success: false, message: updateResult.message };
    }

    await this.messageManager.updateTaskMessage(channelId, messageId, updatedTask, context.interaction.client, now);

    if (depletedItems.length > 0) {
      await this.notifyInventory(
        channelId,
        `@everyone ${task.title}の在庫が切れました: ${formatInventoryDepleted(depletedItems)}`,
        context.interaction.client
      );
    }

    return { success: true };
  }

  private async notifyInventory(channelId: string, message: string, client: ModalHandlerContext['interaction']['client']): Promise<void> {
    if (!this.metadataManager) {
      return;
    }

    const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
    if (!metadataResult.success || !metadataResult.metadata) {
      return;
    }

    const { remindNoticeThreadId, remindNoticeMessageId } = metadataResult.metadata;
    await this.messageManager.sendReminderToThread(
      channelId,
      remindNoticeThreadId,
      remindNoticeMessageId,
      message,
      client
    );
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length === 2 ? parts[1] : null;
  }
}
