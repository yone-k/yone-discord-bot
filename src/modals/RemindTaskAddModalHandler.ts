import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskService } from '../services/RemindTaskService';
import { parseRemindBeforeInput } from '../utils/RemindDuration';
import { normalizeTimeOfDay } from '../utils/RemindSchedule';

export class RemindTaskAddModalHandler extends BaseModalHandler {
  private remindTaskService: RemindTaskService;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    remindTaskService?: RemindTaskService
  ) {
    super('remind-task-add-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.remindTaskService = remindTaskService || new RemindTaskService();
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'add',
      actionName: 'リマインド追加'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ リマインドを追加しました。';
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    const channel = context.interaction.channel;
    const channelId = channel?.isThread()
      ? channel.parentId || context.interaction.channelId
      : context.interaction.channelId;
    if (!channelId) {
      return { success: false, message: 'チャンネル情報が取得できません' };
    }

    const title = context.interaction.fields.getTextInputValue('title').trim();
    const description = context.interaction.fields.getTextInputValue('description').trim();
    const intervalDays = Number(context.interaction.fields.getTextInputValue('interval-days'));
    const timeOfDayInput = context.interaction.fields.getTextInputValue('time-of-day').trim();
    const remindBeforeText = context.interaction.fields.getTextInputValue('remind-before').trim();

    if (title === '') {
      return { success: false, message: 'タスク名を入力してください' };
    }

    if (!Number.isFinite(intervalDays) || intervalDays < 1) {
      return { success: false, message: '周期は1以上を指定してください' };
    }

    let remindBeforeMinutes: number | undefined;
    if (remindBeforeText !== '') {
      try {
        remindBeforeMinutes = parseRemindBeforeInput(remindBeforeText);
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : '事前通知が無効です' };
      }
    }

    let timeOfDay: string | undefined;
    if (timeOfDayInput !== '') {
      try {
        timeOfDay = normalizeTimeOfDay(timeOfDayInput);
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : '時刻の形式が無効です' };
      }
    }

    const result = await this.remindTaskService.addTask(
      channelId,
      {
        title,
        description: description || undefined,
        intervalDays,
        timeOfDay,
        remindBeforeMinutes
      },
      context.interaction.client
    );

    if (!result.success) {
      return { success: false, message: result.message || 'リマインドの追加に失敗しました' };
    }

    return { success: true };
  }
}
