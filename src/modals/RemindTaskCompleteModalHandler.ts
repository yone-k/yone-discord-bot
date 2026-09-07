import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import {
  parseCompletionInput
} from '../utils/RemindInventory';

export class RemindTaskCompleteModalHandler extends BaseModalHandler {
  private repository: RemindTaskRepository;

  constructor(
    logger: Logger,
    operationLogService?: UiOperationEvents,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository
  ) {
    super('remind-task-complete-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
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

    const metadataResult = await this.metadataManager?.getChannelMetadata(channelId);
    const linkedInventoryChannelId = (metadataResult?.metadata as { linkedInventoryChannelId?: string } | undefined)
      ?.linkedInventoryChannelId;
    if (!linkedInventoryChannelId) {
      return { success: false, message: '在庫チャンネルが連携されていません' };
    }

    let completionInput: Array<{ name: string; consume: string | null }>;
    try {
      completionInput = parseCompletionInput(
        context.interaction.fields.getTextInputValue('inventory-items')
      );
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '完了入力の形式が不正です'
      };
    }

    const expectedRevision = context.interaction.customId.split(':')[2];
    if (!expectedRevision) return { success: false, message: 'タスクが変更されました。開き直してください。' };
    try {
      await this.repository.complete(channelId, { ...task, revision: expectedRevision }, completionInput);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '完了結果を確認できません。画面を開き直してください。' };
    }

    return { success: true };
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length >= 2 && parts[1] ? parts[1] : null;
  }

}
