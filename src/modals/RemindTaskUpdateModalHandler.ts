import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { parseRemindBeforeInput } from '../utils/RemindDuration';
import { normalizeTimeOfDay } from '../utils/RemindSchedule';

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
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
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
    const expectedRevision = context.interaction.customId.split(':')[2];
    if (!expectedRevision) return { success: false, message: 'タスクが変更されました。開き直してください。' };
    task.revision = expectedRevision;


    const title = context.interaction.fields.getTextInputValue('title').trim();
    const description = context.interaction.fields.getTextInputValue('description').trim();
    const intervalDays = Number(context.interaction.fields.getTextInputValue('interval-days'));
    const timeOfDayInput = context.interaction.fields.getTextInputValue('time-of-day').trim();
    const remindBeforeText = context.interaction.fields.getTextInputValue('remind-before').trim();
    let remindBeforeMinutes = task.remindBeforeMinutes;
    if (remindBeforeText !== '') {
      try {
        remindBeforeMinutes = parseRemindBeforeInput(remindBeforeText);
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : '事前通知が無効です' };
      }
    }

    if (!Number.isInteger(intervalDays) || intervalDays < 1) {
      return { success: false, message: '周期は1以上を指定してください' };
    }

    let timeOfDay: string;
    try {
      timeOfDay = normalizeTimeOfDay(timeOfDayInput);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '時刻の形式が無効です' };
    }

    const updateResult = await this.repository.patchTask(channelId, task, { title, description: description || null, intervalDays, timeOfDay, remindBeforeMinutes });
    await this.messageManager.updateTaskMessage(channelId, messageId, updateResult.task, context.interaction.client, new Date());

    return { success: true };
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length >= 2 && parts[1] ? parts[1] : null;
  }
}
