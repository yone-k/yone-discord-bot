import type { Client } from 'discord.js';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { InventoryMessageManager } from '../services/InventoryMessageManager';
import { InventoryRepository } from '../services/InventoryRepository';
import { RemindTaskRefreshService, type RefreshOptions } from '../services/RemindTaskRefreshService';
import { parseInventoryEditCsv } from '../utils/InventoryParser';
import { InventoryEditSession } from '../utils/InventoryEditSession';
import { Logger } from '../utils/logger';
interface InventoryRepositoryPort {
    fetchAll(channelId: string): Promise<InventoryItem[]>;
    apply(channelId: string, expected: InventoryItem[], items: InventoryItem[]): Promise<void>;
}
interface InventoryMessageManagerPort {
    createOrUpdateMessage(channelId: string, items: InventoryItem[], title: string, client: Client): Promise<{
        success: boolean;
        errorMessage?: string;
    }>;
}
interface RefreshServicePort {
    refreshTasksUsingInventory(channelId: string, client: Client, options?: RefreshOptions): Promise<void>;
}
export class InventoryUpdateModalHandler extends BaseModalHandler {
  constructor(logger: Logger, private readonly repository: InventoryRepositoryPort = new InventoryRepository(), private readonly messageManager: InventoryMessageManagerPort = InventoryMessageManager.getInstance(), private readonly refreshService: RefreshServicePort = new RemindTaskRefreshService(), private readonly sessions: InventoryEditSession = InventoryEditSession.shared) { super('inventory_update_modal', logger); }
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
      try {
        const saved = await this.repository.fetchAll(interaction.channelId);
        const rendered = await this.messageManager.createOrUpdateMessage(interaction.channelId, saved, '在庫リスト', interaction.client);
        if (!rendered.success)
          throw new Error(rendered.errorMessage || '在庫表示更新に失敗しました');
        await this.refreshService.refreshTasksUsingInventory(interaction.channelId, interaction.client);
      }
      catch (error) {
        this.logger.warn('Inventory saved but display refresh failed', { error: String(error) });
        return { success: false, message: '保存は完了しましたが表示更新に失敗しました。/init-inventoryで再表示してください。' };
      }
      return { success: true, affectedItems: items.length };
    }
    catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '保存に失敗しました' };
    }
  }
  protected getOperationInfo(): OperationInfo { return { operationType: 'update', actionName: '在庫アイテム更新' }; }
  protected getSuccessMessage(): string { return '✅ 在庫アイテムを更新しました。'; }
}
