import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
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

export class RemindTaskCompleteButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager
  ) {
    super('remind-task-complete', logger, operationLogService, metadataManager);
    this.ephemeral = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'complete',
      actionName: 'リマインド完了'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const interaction = context.interaction;

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: ['Ephemeral'] as const });
    }

    const replyError = async (message: string): Promise<OperationResult> => {
      try {
        await interaction.editReply({ content: message });
      } catch {
        // ignore reply failures
      }
      return { success: false, message };
    };

    try {
      const channelId = interaction.channelId;
      const messageId = interaction.message?.id;
      if (!channelId || !messageId) {
        return await replyError('チャンネル情報が取得できません');
      }

      const task = await this.repository.findTaskByMessageId(channelId, messageId);
      if (!task) {
        return await replyError('タスクが見つかりません');
      }

      const insufficientItems = getInsufficientInventoryItems(task.inventoryItems);
      if (insufficientItems.length > 0) {
        await this.notifyInventory(
          channelId,
          `@everyone ${task.title}の在庫が不足しています: ${formatInventoryShortage(insufficientItems)}`,
          interaction.client
        );
        return await replyError(`在庫が不足しています: ${formatInventoryShortage(insufficientItems)}`);
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
        return await replyError(updateResult.message || '更新に失敗しました');
      }

      await this.messageManager.updateTaskMessage(channelId, messageId, updatedTask, interaction.client, now);

      if (depletedItems.length > 0) {
        await this.notifyInventory(
          channelId,
          `@everyone ${task.title}の在庫が切れました: ${formatInventoryDepleted(depletedItems)}`,
          interaction.client
        );
      }

      try {
        await interaction.deleteReply();
      } catch {
        // ignore delete failures
      }

      return { success: true };
    } catch {
      return await replyError('処理中にエラーが発生しました');
    }
  }

  private async notifyInventory(channelId: string, message: string, client: ButtonHandlerContext['interaction']['client']): Promise<void> {
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
}
