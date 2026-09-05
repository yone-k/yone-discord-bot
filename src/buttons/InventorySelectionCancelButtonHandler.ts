import { MessageFlags } from 'discord.js';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import type { InventoryChannelMetadata } from '../models/InventoryChannelMetadata';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import type { MetadataProvider } from '../services/MetadataProvider';
import type { OperationLogService } from '../services/OperationLogService';
import { InventoryChannelStore } from '../services/InventoryChannelStore';
import { InventoryRepository } from '../services/InventoryRepository';
import { InventoryFormatter } from '../ui/InventoryFormatter';
import { Logger } from '../utils/logger';

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

interface InventoryMetadataReader {
  getChannelMetadata(channelId: string): Promise<InventoryChannelMetadata | null>;
}

export class InventorySelectionCancelButtonHandler extends BaseButtonHandler {
  private readonly repository: InventoryRepositoryPort;
  private readonly inventoryMetadataManager?: InventoryMetadataReader;

  constructor(
    logger: Logger,
    repository: InventoryRepositoryPort = new InventoryRepository(),
    inventoryMetadataManager?: InventoryMetadataReader,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    super('inventory_selection_cancel', logger, operationLogService, metadataManager);
    this.repository = repository;
    this.inventoryMetadataManager = inventoryMetadataManager;
    this.ephemeral = false;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    if (!channelId) {
      return { success: false, message: 'チャンネルIDが取得できません' };
    }

    const items = await this.repository.fetchAll(channelId);
    const metadata = await this.getInventoryMetadata(channelId);
    const listTitle = metadata?.listTitle || '在庫リスト';
    const defaultCategory = metadata?.defaultCategory;
    const content = items.length === 0
      ? await InventoryFormatter.formatEmptyContent(listTitle, channelId, defaultCategory)
      : await InventoryFormatter.formatDataContent(items, listTitle, channelId, defaultCategory);
    const components = InventoryFormatter.buildInventoryComponents(content);

    await context.interaction.update({
      flags: MessageFlags.IsComponentsV2,
      components
    });

    return { success: true, message: '在庫選択をキャンセルしました' };
  }

  protected getOperationInfo(_context: ButtonHandlerContext): OperationInfo {
    return {
      operationType: 'update',
      actionName: '在庫選択キャンセル'
    };
  }

  private async getInventoryMetadata(channelId: string): Promise<InventoryChannelMetadata | null> {
    const metadataManager = this.inventoryMetadataManager ?? InventoryChannelStore.getInstance();
    return metadataManager.getChannelMetadata(channelId);
  }
}
