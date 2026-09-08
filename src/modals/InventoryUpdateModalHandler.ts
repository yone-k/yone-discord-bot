import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { InventoryRepository } from '../services/InventoryRepository';
import { parseInventoryEditCsv } from '../utils/InventoryParser';
import { InventoryEditSession } from '../utils/InventoryEditSession';
import { Logger } from '../utils/logger';
interface InventoryRepositoryPort {
    apply(channelId: string, expected: InventoryItem[], items: InventoryItem[]): Promise<void>;
}
export class InventoryUpdateModalHandler extends BaseModalHandler {
  constructor(logger: Logger, private readonly repository: InventoryRepositoryPort = new InventoryRepository(), private readonly sessions: InventoryEditSession = InventoryEditSession.shared) {
    super('inventory_update_modal', logger);
    this.deleteOnSuccess = true;
  }
  public shouldHandle(context: ModalHandlerContext): boolean { return context.interaction.customId === this.customId || context.interaction.customId.startsWith(`${this.customId}:`); }
  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    const { interaction } = context;
    try {
      if (!interaction.channelId)
        throw new Error('チャンネルIDが取得できません');
      const token = interaction.customId.slice(this.customId.length + 1);
      const original = this.sessions.get(token, interaction.channelId, interaction.user.id);
      const items = parseInventoryEditCsv(interaction.fields.getTextInputValue('items'), original);
      await this.repository.apply(interaction.channelId, original, items);
      this.sessions.close(token);
      return { success: true, affectedItems: items.length };
    }
    catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '保存に失敗しました' };
    }
  }
  protected getOperationInfo(): OperationInfo { return { operationType: 'update', actionName: '在庫アイテム更新' }; }
  protected getSuccessMessage(): string { return '✅ 在庫アイテムを更新しました。'; }
}
