import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import type { MetadataProvider } from '../services/MetadataProvider';
import type { UiOperationEvents } from '../services/UiOperationEvents';
import { InventoryRepository } from '../services/InventoryRepository';
import { OutputApi } from '../api/OutputApi';
import { CoreApiError } from '../api/CoreClient';
import { Logger } from '../utils/logger';

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

export class InventoryDeleteButtonHandler extends BaseButtonHandler {
  private readonly repository: InventoryRepositoryPort;

  constructor(
    logger: Logger,
    repository: InventoryRepositoryPort = new InventoryRepository(),
    private readonly outputs: Pick<OutputApi, 'setCardView'> = new OutputApi(),
    operationLogService?: UiOperationEvents,
    metadataManager?: MetadataProvider
  ) {
    super('inventory_delete', logger, operationLogService, metadataManager);
    this.repository = repository;
    this.ephemeral = true;
  }

  public shouldHandle(context: ButtonHandlerContext): boolean {
    if (context.interaction.user.bot) {
      return false;
    }

    return context.interaction.customId === this.customId
      || context.interaction.customId.startsWith(`${this.customId}?page=`);
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const { interaction } = context;
    const channelId = interaction.channelId;
    if (!channelId) {
      await interaction.reply({ content: 'チャンネルIDが取得できません', flags: ['Ephemeral'] });
      return { success: false, message: 'チャンネルIDが取得できません' };
    }
    await interaction.deferUpdate();
    try {
      const items = await this.repository.fetchAll(channelId);
      if (items.length === 0) {
        await interaction.followUp({ content: '在庫アイテムがありません。', flags: ['Ephemeral'] });
        return { success: false, message: '在庫アイテムがありません' };
      }
      const page = this.parsePage(interaction.customId);
      await this.outputs.setCardView(channelId, 'inventory', channelId, { mode: 'delete_selection', page });
      return { success: true, message: '在庫削除セレクトメニューを表示しました' };
    } catch (error) {
      const message = error instanceof CoreApiError ? error.message : 'エラーが発生しました。もう一度お試しください。';
      await interaction.followUp({ content: message, flags: ['Ephemeral'] });
      return { success: false, message };
    }
  }

  protected getOperationInfo(_context: ButtonHandlerContext): OperationInfo {
    return {
      operationType: 'delete',
      actionName: '在庫アイテム削除'
    };
  }

  private parsePage(customId: string): number {
    const page = new URLSearchParams(customId.split('?')[1] ?? '').get('page');
    const parsed = Number(page ?? 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

}
