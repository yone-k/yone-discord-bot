import { randomUUID } from 'node:crypto';
import { Client } from 'discord.js';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { InventoryChannelStore } from '../services/InventoryChannelStore';
import { InventoryMessageManager } from '../services/InventoryMessageManager';
import { InventoryRepository } from '../services/InventoryRepository';
import { InventoryService } from '../services/InventoryService';
import { parseInventoryAddCsvText } from '../utils/InventoryParser';
import { Logger } from '../utils/logger';

interface InventoryServicePort {
  create(channelId: string, item: InventoryItem): Promise<{ success: boolean; message?: string }>;
}

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

interface InventoryMetadataReaderPort {
  getChannelMetadata(channelId: string): Promise<{ defaultCategory?: string } | null>;
}

interface InventoryMessageManagerPort {
  createOrUpdateMessage(
    channelId: string,
    items: InventoryItem[],
    listTitle: string,
    client: Client
  ): Promise<{ success: boolean; errorMessage?: string }>;
}

export class InventoryAddModalHandler extends BaseModalHandler {
  private readonly inventoryService: InventoryServicePort;
  private readonly metadataReader: InventoryMetadataReaderPort;
  private readonly repository: InventoryRepositoryPort;
  private readonly messageManager: InventoryMessageManagerPort;

  constructor(
    logger: Logger,
    inventoryService: InventoryServicePort = InventoryService.getInstance(),
    metadataReader: InventoryMetadataReaderPort = InventoryChannelStore.getInstance(),
    repository: InventoryRepositoryPort = new InventoryRepository(),
    messageManager: InventoryMessageManagerPort = InventoryMessageManager.getInstance()
  ) {
    super('inventory_add_modal', logger);
    this.inventoryService = inventoryService;
    this.metadataReader = metadataReader;
    this.repository = repository;
    this.messageManager = messageManager;
    this.deleteOnSuccess = true;
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    if (!channelId) {
      return { success: false, message: 'チャンネルIDが取得できません' };
    }

    const itemsText = context.interaction.fields.getTextInputValue('items');
    const categoryInput = context.interaction.fields.getTextInputValue('category');
    let parsed: { name: string; stock: string }[];
    try {
      parsed = parseInventoryAddCsvText(itemsText);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '入力形式が無効です'
      };
    }

    if (parsed.length === 0) {
      return { success: false, message: '少なくとも1件入力してください' };
    }

    const trimmed = (categoryInput ?? '').trim();
    const metadata = await this.metadataReader.getChannelMetadata(channelId);
    const defaultCategory = metadata?.defaultCategory ?? '';
    const unifiedCategory = trimmed !== '' ? trimmed : defaultCategory;
    const skipped: string[] = [];

    for (const item of parsed) {
      const result = await this.inventoryService.create(channelId, {
        id: randomUUID(),
        name: item.name,
        stock: item.stock,
        category: unifiedCategory
      });

      if (!result.success) {
        this.logger.warn('Skipped inventory item', {
          name: item.name,
          message: result.message
        });
        skipped.push(item.name);
      }
    }

    const items = await this.repository.fetchAll(channelId);
    await this.messageManager.createOrUpdateMessage(
      channelId,
      items,
      '在庫リスト',
      context.interaction.client
    );

    if (skipped.length > 0) {
      return { success: true, message: `一部スキップ: ${skipped.join(', ')}` };
    }

    return { success: true };
  }

  protected getOperationInfo(_context: ModalHandlerContext): OperationInfo {
    return {
      operationType: 'add',
      actionName: '在庫アイテム追加'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ 在庫アイテムを追加しました。';
  }
}
