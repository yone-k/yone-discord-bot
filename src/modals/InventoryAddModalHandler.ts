import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { InventoryChannelStore } from '../services/InventoryChannelStore';
import { InventoryService } from '../services/InventoryService';
import { parseInventoryAddCsvText } from '../utils/InventoryParser';
import { Logger } from '../utils/logger';

interface InventoryServicePort {
  createMany(channelId: string, items: Omit<InventoryItem, 'id'>[]): Promise<string[]>;
}


interface InventoryMetadataReaderPort {
  getChannelMetadata(channelId: string): Promise<{ defaultCategory?: string } | null>;
}


export class InventoryAddModalHandler extends BaseModalHandler {
  private readonly inventoryService: InventoryServicePort;
  private readonly metadataReader: InventoryMetadataReaderPort;

  constructor(
    logger: Logger,
    inventoryService: InventoryServicePort = InventoryService.getInstance(),
    metadataReader: InventoryMetadataReaderPort = InventoryChannelStore.getInstance()
  ) {
    super('inventory_add_modal', logger);
    this.inventoryService = inventoryService;
    this.metadataReader = metadataReader;
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
    const skipped = await this.inventoryService.createMany(channelId, parsed.map(item => ({ ...item, category: unifiedCategory })));
    for (const name of skipped) {
      this.logger.warn('Skipped inventory item', { name, message: '同名のアイテムが既に存在します' });
    }

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
