import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { parseInventoryInput } from '../utils/RemindInventory';

export class RemindTaskInventoryModalHandler extends BaseModalHandler {
  private repository: RemindTaskRepository;

  constructor(
    logger: Logger,
    operationLogService?: UiOperationEvents,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository
  ) {
    super('remind-task-inventory-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
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
    const expectedRevision = context.interaction.customId.split(':')[2];
    if (!expectedRevision) return { success: false, message: 'タスクが変更されました。開き直してください。' };
    task.revision = expectedRevision;


    const input = context.interaction.fields.getTextInputValue('inventory-items');
    try {
      const items = parseInventoryInput(input);
      await this.repository.editInventorySettings(channelId, task, items);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '在庫の更新に失敗しました' };
    }
    return { success: true };
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length >= 2 && parts[1] ? parts[1] : null;
  }
}
