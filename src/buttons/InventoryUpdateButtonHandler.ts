import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { DEFAULT_CATEGORY } from '../models/CategoryType';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import type { MetadataProvider } from '../services/MetadataProvider';
import type { OperationLogService } from '../services/OperationLogService';
import { InventoryMetadataManager } from '../services/InventoryMetadataManager';
import type { InventoryChannelMetadata } from '../services/InventoryMetadataManager';
import { InventoryRepository } from '../services/InventoryRepository';
import { formatInventoryCsvText } from '../utils/InventoryParser';
import { Logger } from '../utils/logger';

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

interface InventoryMetadataReader {
  getChannelMetadata(channelId: string): Promise<InventoryChannelMetadata | null>;
}

type MetadataProviderResult = Awaited<ReturnType<MetadataProvider['getChannelMetadata']>>;

export class InventoryUpdateButtonHandler extends BaseButtonHandler {
  private readonly repository: InventoryRepositoryPort;
  private readonly inventoryMetadataReader: InventoryMetadataReader;

  constructor(
    logger: Logger,
    repository: InventoryRepositoryPort = new InventoryRepository(),
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    inventoryMetadataReader?: InventoryMetadataReader
  ) {
    super('inventory_update', logger, operationLogService, metadataManager);
    this.repository = repository;
    this.inventoryMetadataReader = inventoryMetadataReader ?? this.createInventoryMetadataReader(metadataManager);
    this.ephemeral = true;
  }

  public shouldHandle(context: ButtonHandlerContext): boolean {
    if (context.interaction.user.bot) {
      return false;
    }

    return context.interaction.customId === this.customId;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const items = await this.repository.fetchAll(channelId);
    const defaultCategory = await this.getDefaultCategory(channelId);
    const csvText = formatInventoryCsvText(items, defaultCategory);

    await context.interaction.showModal(this.buildModal(csvText));
    return { success: true, message: '在庫更新モーダルを表示しました', affectedItems: items.length };
  }

  protected getOperationInfo(_context: ButtonHandlerContext): OperationInfo {
    return {
      operationType: 'update',
      actionName: '在庫アイテム更新'
    };
  }

  private buildModal(csvText: string): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId('inventory_update_modal')
      .setTitle('在庫を更新');

    const itemsInput = new TextInputBuilder()
      .setCustomId('items')
      .setLabel('在庫一覧（名前,在庫数,カテゴリ）を編集')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000)
      .setPlaceholder('例: 洗剤,3,日用品\n米,10,食品')
      .setValue(csvText);

    return modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(itemsInput)
    );
  }

  private createInventoryMetadataReader(metadataManager?: MetadataProvider): InventoryMetadataReader {
    if (metadataManager) {
      return {
        getChannelMetadata: async (channelId: string): Promise<InventoryChannelMetadata | null> => {
          const result = await metadataManager.getChannelMetadata(channelId) as MetadataProviderResult | null;
          if (!result?.success || !result.metadata) {
            return null;
          }

          return {
            channelId,
            messageId: result.metadata.messageId ?? '',
            listTitle: result.metadata.listTitle ?? '',
            lastSyncTime: new Date(),
            defaultCategory: result.metadata.defaultCategory ?? '',
            operationLogThreadId: result.metadata.operationLogThreadId ?? undefined
          };
        }
      };
    }

    return {
      getChannelMetadata: (channelId: string): Promise<InventoryChannelMetadata | null> => {
        return InventoryMetadataManager.getInstance().getChannelMetadata(channelId);
      }
    };
  }

  private async getDefaultCategory(channelId: string): Promise<string> {
    try {
      const metadata = await this.inventoryMetadataReader.getChannelMetadata(channelId);
      const rawDefault = metadata?.defaultCategory;
      if (rawDefault && rawDefault.trim() !== '') {
        return rawDefault;
      }
    } catch (error) {
      this.logger.warn('Failed to get inventory metadata for default category', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return DEFAULT_CATEGORY;
  }
}
