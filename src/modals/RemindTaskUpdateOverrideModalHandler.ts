import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { MetadataProvider } from '../services/MetadataProvider';
import { OperationLogService } from '../services/OperationLogService';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { normalizeTimeOfDay } from '../utils/RemindSchedule';
import { Logger } from '../utils/logger';

export class RemindTaskUpdateOverrideModalHandler extends BaseModalHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager
  ) {
    super('remind-task-update-override-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId.startsWith('remind-task-update-override-modal:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: 'リマインド詳細設定'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ 詳細設定を更新しました。';
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

    let lastDoneAt: Date | undefined;
    let nextDueAt: Date | undefined;
    const limitText = context.interaction.fields.getTextInputValue('overdue-notify-limit').trim();
    let overdueNotifyLimit: number | undefined;
    try {
      lastDoneAt = this.parseOverrideDate(
        context.interaction.fields.getTextInputValue('last-done-at'),
        task.timeOfDay,
        '前回完了日'
      );
      nextDueAt = this.parseOverrideDate(
        context.interaction.fields.getTextInputValue('next-due-at'),
        task.timeOfDay,
        '次回期限'
      );
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '日付の形式が無効です' };
    }

    if (limitText === '') {
      overdueNotifyLimit = undefined;
    } else {
      const parsedLimit = Number(limitText);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 0) {
        return { success: false, message: '期限超過通知の上限回数が無効です' };
      }
      overdueNotifyLimit = parsedLimit;
    }

    if (!lastDoneAt && !nextDueAt && limitText === '' && task.overdueNotifyLimit === undefined) {
      return { success: false, message: '前回完了日、次回期限、上限回数のいずれかを入力してください' };
    }

    const shouldResetNotifications = !!lastDoneAt || !!nextDueAt;
    const resolvedLastDoneAt = lastDoneAt ?? task.lastDoneAt;
    const resolvedNextDueAt = nextDueAt ?? task.nextDueAt;

    if (resolvedLastDoneAt && resolvedLastDoneAt.getTime() > resolvedNextDueAt.getTime()) {
      return { success: false, message: '前回完了日は次回期限より前の日付を指定してください' };
    }

    const now = new Date();
    const updatedTask = {
      ...task,
      lastDoneAt: resolvedLastDoneAt,
      nextDueAt: resolvedNextDueAt,
      overdueNotifyLimit,
      lastRemindDueAt: shouldResetNotifications ? null : task.lastRemindDueAt,
      overdueNotifyCount: shouldResetNotifications ? 0 : task.overdueNotifyCount,
      lastOverdueNotifiedAt: shouldResetNotifications ? null : task.lastOverdueNotifiedAt,
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

  private parseOverrideDate(input: string, fallbackTimeOfDay: string, label: string): Date | undefined {
    const trimmed = input.trim();
    if (trimmed === '') {
      return undefined;
    }

    const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/.exec(trimmed);
    if (!match) {
      throw new Error(`${label}の形式が無効です`);
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timeOfDay = match[4] !== undefined ? `${match[4]}:${match[5]}` : fallbackTimeOfDay;
    const normalizedTime = normalizeTimeOfDay(timeOfDay);
    const [hours, minutes] = normalizedTime.split(':').map((value) => Number(value));

    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+09:00`;
    const date = new Date(iso);
    if (isNaN(date.getTime())) {
      throw new Error(`${label}が無効です`);
    }

    const tokyoDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    if (
      tokyoDate.getUTCFullYear() !== year
      || tokyoDate.getUTCMonth() + 1 !== month
      || tokyoDate.getUTCDate() !== day
    ) {
      throw new Error(`${label}が無効です`);
    }

    return date;
  }
}
