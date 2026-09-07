import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { Logger } from '../utils/logger';
import { ListRepository, RepositoryError } from '../api/contracts';
import { ApiListRepository } from '../api/Repositories';
import { ListChannelStore } from '../services/ListChannelStore';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { parseListCsv } from '../utils/ListInput';
import { listChanges, listLogItems } from '../utils/ListChanges';
export class EditListModalHandler extends BaseModalHandler {
  constructor(logger: Logger, private repository: ListRepository = new ApiListRepository(), metadataManager: ListChannelStore = ListChannelStore.getInstance(), operationLogService?: UiOperationEvents) {
    super('edit-list-modal', logger, operationLogService, metadataManager);
  }
  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId === this.customId || context.interaction.customId.startsWith(`${this.customId}:`);
  }
  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    try {
      const { interaction } = context;
      const match = /^edit-list-modal:(\d+):(\d+):(\d+)$/.exec(interaction.customId);
      if (!match || match[1] !== interaction.channelId || match[2] !== interaction.user.id) {
        return { success: false, message: 'この編集画面は使用できません。リスト編集を開き直してください。' };
      }
      const items = parseListCsv(interaction.fields.getTextInputValue('list-data'));
      const before = await this.repository.fetchAll(match[1]);
      await this.repository.save(match[1], match[3], items);
      return { success: true, affectedItems: items.length, message: 'リストを更新しました', details: { items: listLogItems(items), changes: listChanges(before, items) } };
    }
    catch (error) {
      return { success: false, message: error instanceof RepositoryError && error.code === 'conflict'
        ? '別の操作でリストが更新されました。編集を開き直してください。'
        : error instanceof Error ? error.message : '保存に失敗しました' };
    }
  }
  protected getOperationInfo(): OperationInfo { return { operationType: 'edit', actionName: 'アイテム編集' }; }
  protected getSuccessMessage(): string { return '✅ リストを更新しました'; }
}
