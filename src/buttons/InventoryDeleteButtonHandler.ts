import { MessageFlags } from 'discord.js';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import type { InventoryChannelMetadata } from '../models/InventoryChannelMetadata';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import type { MetadataProvider } from '../services/MetadataProvider';
import type { OperationLogService } from '../services/OperationLogService';
import { InventoryMetadataManager } from '../services/InventoryMetadataManager';
import { InventoryRepository } from '../services/InventoryRepository';
import { InventoryFormatter } from '../ui/InventoryFormatter';
import { Logger } from '../utils/logger';

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

interface InventoryMetadataReader {
  getChannelMetadata(channelId: string): Promise<InventoryChannelMetadata | null>;
}

export class InventoryDeleteButtonHandler extends BaseButtonHandler {
  private readonly repository: InventoryRepositoryPort;
  private readonly inventoryMetadataManager?: InventoryMetadataReader;

  constructor(
    logger: Logger,
    repository: InventoryRepositoryPort = new InventoryRepository(),
    inventoryMetadataManager?: InventoryMetadataReader,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    super('inventory_delete', logger, operationLogService, metadataManager);
    this.repository = repository;
    this.inventoryMetadataManager = inventoryMetadataManager;
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
    const channelId = context.interaction.channelId;
    const items = await this.repository.fetchAll(channelId);

    if (items.length === 0) {
      await context.interaction.reply({
        content: '在庫アイテムがありません。',
        flags: ['Ephemeral']
      });
      return { success: false, message: '在庫アイテムがありません' };
    }

    const page = this.parsePage(context.interaction.customId);
    const metadata = await this.getInventoryMetadata(channelId);
    const listTitle = metadata?.listTitle || '在庫リスト';
    const defaultCategory = metadata?.defaultCategory;
    const content = await InventoryFormatter.formatDataContent(items, listTitle, channelId, defaultCategory);
    const components = InventoryFormatter.buildInventorySelectionComponents(content, items, 'delete', page);
    await context.interaction.update({
      flags: MessageFlags.IsComponentsV2,
      components
    });
    return { success: true, message: '在庫削除セレクトメニューを表示しました' };
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

  private async getInventoryMetadata(channelId: string): Promise<InventoryChannelMetadata | null> {
    const metadataManager = this.inventoryMetadataManager ?? InventoryMetadataManager.getInstance();
    return metadataManager.getChannelMetadata(channelId);
  }
}
