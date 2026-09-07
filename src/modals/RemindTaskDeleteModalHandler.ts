import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';

export class RemindTaskDeleteModalHandler extends BaseModalHandler {
  private repository: RemindTaskRepository;

  constructor(
    logger: Logger,
    operationLogService?: UiOperationEvents,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository
  ) {
    super('remind-task-delete-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId.startsWith('remind-task-delete-modal:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'delete',
      actionName: 'リマインド削除'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ リマインドを削除しました。';
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const messageId = this.parseMessageId(context.interaction.customId);
    if (!channelId || !messageId) {
      return { success: false, message: 'チャンネル情報が取得できません' };
    }

    const confirm = context.interaction.fields.getTextInputValue('confirm');
    if (confirm !== '削除') {
      return { success: false, message: '削除をキャンセルしました' };
    }

    const task = await this.repository.findTaskByMessageId(channelId, messageId);
    if (!task) {
      return { success: false, message: 'タスクが見つかりません' };
    }

    const deleteResult = await this.repository.deleteTask(channelId, task.id);
    if (!deleteResult.success) {
      return { success: false, message: deleteResult.message };
    }


    return { success: true };
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length === 2 ? parts[1] : null;
  }
}
