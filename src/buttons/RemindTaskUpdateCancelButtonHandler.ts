import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { MetadataProvider } from '../services/MetadataProvider';
import { OutputApi } from '../api/OutputApi';
import { CoreApiError } from '../api/CoreClient';
import { RemindTaskRepository } from '../services/RemindTaskRepository';

export class RemindTaskUpdateCancelButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;
  private outputs: Pick<OutputApi, 'setCardView'>;

  constructor(
    logger: Logger,
    operationLogService?: UiOperationEvents,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    outputs?: Pick<OutputApi, 'setCardView'>
  ) {
    super('remind-task-update-cancel', logger, operationLogService, metadataManager);
    this.repository = repository || new RemindTaskRepository();
    this.outputs = outputs ?? new OutputApi();
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  public shouldHandle(context: ButtonHandlerContext): boolean {
    if (context.interaction.user.bot) {
      return false;
    }

    return context.interaction.customId.startsWith('remind-task-update-cancel:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: 'リマインド更新キャンセル'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const messageId = this.parseMessageId(context.interaction.customId);
    if (!channelId || !messageId) {
      return { success: false, message: 'チャンネル情報が取得できません' };
    }

    await context.interaction.deferUpdate();
    try {
      const task = await this.repository.findTaskByMessageId(channelId, messageId);
      if (!task) {
        await context.interaction.followUp({ content: 'タスクが見つかりません', flags: ['Ephemeral'] as const });
        return { success: false, message: 'タスクが見つかりません' };
      }
      await this.outputs.setCardView(channelId, 'task', task.id, { mode: 'normal' });
      return { success: true, message: '更新選択を取り消しました' };
    } catch (error) {
      const message = error instanceof CoreApiError ? error.message : '更新選択を取り消せませんでした。画面を開き直してください。';
      await context.interaction.followUp({ content: message, flags: ['Ephemeral'] as const });
      return { success: false, message };
    }
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length === 2 ? parts[1] : null;
  }
}
