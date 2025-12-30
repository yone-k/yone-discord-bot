import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { RemindTaskFormatter } from '../ui/RemindTaskFormatter';
import { calculateNextDueAt } from '../utils/RemindSchedule';

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
      await interaction.deferReply({ ephemeral: true });
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

      const embed = RemindTaskFormatter.formatTaskEmbed(updatedTask, now);
      await this.messageManager.updateTaskMessage(channelId, messageId, embed, interaction.client);

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
}
