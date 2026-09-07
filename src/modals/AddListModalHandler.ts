import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { Logger } from '../utils/logger';
import { ListRepository, RepositoryError } from '../api/contracts';
import { ApiListRepository } from '../api/Repositories';
import { ListChannelStore } from '../services/ListChannelStore';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { parseListAdd } from '../utils/ListInput';
import { listLogItems } from '../utils/ListChanges';
export class AddListModalHandler extends BaseModalHandler {
  constructor(logger: Logger, private repository: ListRepository = new ApiListRepository(), metadataManager: ListChannelStore = ListChannelStore.getInstance(), operationLogService?: UiOperationEvents) { super('add-list-modal', logger, operationLogService, metadataManager); }
  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    try {
      const { interaction } = context;
      if (!interaction.channelId)
        throw new Error('チャンネルIDが取得できません');
      const items = parseListAdd(interaction.fields.getTextInputValue('items'), interaction.fields.getTextInputValue('category'));
      const snapshot = await this.repository.snapshot(interaction.channelId);
      if (snapshot.items.length + items.length > 100)
        throw new Error('アイテムは最大100件です');
      await this.repository.save(interaction.channelId, snapshot.editVersion, [...snapshot.items, ...items]);
      return { success: true, affectedItems: items.length, message: 'アイテムを追加しました', details: { items: listLogItems(items) } };
    }
    catch (error) {
      return { success: false, message: error instanceof RepositoryError && error.code === 'conflict'
        ? '別の操作でリストが更新されました。追加を開き直してください。' : error instanceof Error ? error.message : '追加に失敗しました' };
    }
  }
  protected getOperationInfo(): OperationInfo { return { operationType: 'add', actionName: 'アイテム追加' }; }
  protected getSuccessMessage(): string { return '✅ アイテムを追加しました'; }
}
