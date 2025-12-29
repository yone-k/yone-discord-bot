import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { RemindTaskFormatter } from '../ui/RemindTaskFormatter';
import { calculateNextDueAt, calculateStartAt } from '../utils/RemindSchedule';

export class RemindTaskUpdateModalHandler extends BaseModalHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager
  ) {
    super('remind-task-update-modal', logger, operationLogService, metadataManager);
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId.startsWith('remind-task-update-modal:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: 'リマインド更新'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ リマインドを更新しました。';
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

    const title = context.interaction.fields.getTextInputValue('title').trim();
    const description = context.interaction.fields.getTextInputValue('description').trim();
    const intervalDays = Number(context.interaction.fields.getTextInputValue('interval-days'));
    const timeOfDay = context.interaction.fields.getTextInputValue('time-of-day').trim();
    const remindBeforeText = context.interaction.fields.getTextInputValue('remind-before').trim();
    const remindBeforeMinutes = remindBeforeText === '' ? task.remindBeforeMinutes : Number(remindBeforeText);

    if (!Number.isFinite(intervalDays) || intervalDays < 1) {
      return { success: false, message: '周期は1以上を指定してください' };
    }

    if (!Number.isFinite(remindBeforeMinutes) || remindBeforeMinutes < 0 || remindBeforeMinutes > 10080) {
      return { success: false, message: '事前通知は0〜10080の範囲で指定してください' };
    }

    const now = new Date();
    const startAt = calculateStartAt(task.createdAt, timeOfDay);
    const nextDueAt = calculateNextDueAt(
      {
        intervalDays,
        timeOfDay,
        startAt,
        lastDoneAt: task.lastDoneAt
      },
      now
    );

    const updatedTask = {
      ...task,
      title,
      description: description || undefined,
      intervalDays,
      timeOfDay,
      remindBeforeMinutes,
      startAt,
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

    const embed = RemindTaskFormatter.formatTaskEmbed(updatedTask, now);
    await this.messageManager.updateTaskMessage(channelId, messageId, embed, context.interaction.client);

    return { success: true };
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length === 2 ? parts[1] : null;
  }
}
