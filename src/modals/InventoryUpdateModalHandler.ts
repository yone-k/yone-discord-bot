import { randomUUID } from 'node:crypto';
import type { Client } from 'discord.js';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { InventoryMessageManager } from '../services/InventoryMessageManager';
import { InventoryRepository } from '../services/InventoryRepository';
import { InventoryService } from '../services/InventoryService';
import { RemindTaskRefreshService, type RefreshOptions } from '../services/RemindTaskRefreshService';
import { parseInventoryCsvText } from '../utils/InventoryParser';
import { Logger } from '../utils/logger';

interface InventoryServicePort {
  create(channelId: string, item: InventoryItem): Promise<{ success: boolean; message?: string }>;
  update(channelId: string, item: InventoryItem): Promise<{ success: boolean; message?: string }>;
  delete(channelId: string, id: string): Promise<void>;
}

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

interface InventoryMessageManagerPort {
  createOrUpdateMessage(
    channelId: string,
    items: InventoryItem[],
    listTitle: string,
    client: Client
  ): Promise<{ success: boolean; errorMessage?: string }>;
}

interface RefreshServicePort {
  refreshTasksUsingInventory(
    linkedInventoryChannelId: string,
    client: Client,
    options?: RefreshOptions
  ): Promise<void>;
}

export class InventoryUpdateModalHandler extends BaseModalHandler {
  private static readonly customId = 'inventory_update_modal';

  private readonly inventoryService: InventoryServicePort;
  private readonly messageManager: InventoryMessageManagerPort;
  private readonly repository: InventoryRepositoryPort;
  private readonly refreshService: RefreshServicePort;

  constructor(
    logger: Logger,
    inventoryService: InventoryServicePort = InventoryService.getInstance(),
    repository: InventoryRepositoryPort = new InventoryRepository(),
    messageManager: InventoryMessageManagerPort = InventoryMessageManager.getInstance(),
    refreshService: RefreshServicePort = new RemindTaskRefreshService()
  ) {
    super(InventoryUpdateModalHandler.customId, logger);
    this.inventoryService = inventoryService;
    this.messageManager = messageManager;
    this.repository = repository;
    this.refreshService = refreshService;
    this.deleteOnSuccess = true;
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId === InventoryUpdateModalHandler.customId
      || context.interaction.customId.startsWith(`${InventoryUpdateModalHandler.customId}:`);
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    if (!channelId) {
      return { success: false, message: 'チャンネルIDが取得できません' };
    }

    const csvText = context.interaction.fields.getTextInputValue('items');
    let editedItems;
    try {
      editedItems = parseInventoryCsvText(csvText);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '在庫CSVの形式が正しくありません'
      };
    }

    const currentItems = await this.repository.fetchAll(channelId);
    const currentByName = new Map(currentItems.map(item => [item.name, item]));
    const editedByName = new Map(editedItems.map(item => [item.name, item]));
    const deleteErrors: string[] = [];

    for (const editedItem of editedItems) {
      const currentItem = currentByName.get(editedItem.name);
      if (currentItem) {
        continue;
      }

      const createResult = await this.inventoryService.create(channelId, {
        id: randomUUID(),
        name: editedItem.name,
        stock: editedItem.stock,
        category: editedItem.category ?? ''
      });

      if (!createResult.success) {
        return { success: false, message: createResult.message || `${editedItem.name}の追加に失敗しました` };
      }
    }

    for (const editedItem of editedItems) {
      const currentItem = currentByName.get(editedItem.name);
      if (!currentItem) {
        continue;
      }

      const nextCategory = editedItem.category ?? '';
      if (currentItem.stock === editedItem.stock && currentItem.category === nextCategory) {
        continue;
      }

      const updateResult = await this.inventoryService.update(channelId, {
        ...currentItem,
        stock: editedItem.stock,
        category: nextCategory
      });

      if (!updateResult.success) {
        return { success: false, message: updateResult.message || `${editedItem.name}の更新に失敗しました` };
      }
    }

    for (const currentItem of currentItems) {
      if (editedByName.has(currentItem.name)) {
        continue;
      }

      try {
        await this.inventoryService.delete(channelId, currentItem.id);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        deleteErrors.push(`${currentItem.name}: ${errorMessage}`);
      }
    }

    if (deleteErrors.length > 0) {
      return {
        success: false,
        message: `削除できない在庫アイテムがあります。\n${deleteErrors.join('\n')}`
      };
    }

    const items = await this.repository.fetchAll(channelId);
    const messageResult = await this.messageManager.createOrUpdateMessage(
      channelId,
      items,
      '在庫リスト',
      context.interaction.client
    );
    if (!messageResult.success) {
      return { success: false, message: messageResult.errorMessage || '在庫メッセージの更新に失敗しました' };
    }

    try {
      await this.refreshService.refreshTasksUsingInventory(channelId, context.interaction.client);
    } catch (error) {
      this.logger.warn('Failed to refresh task messages using inventory', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return { success: true };
  }

  protected getOperationInfo(_context: ModalHandlerContext): OperationInfo {
    return {
      operationType: 'update',
      actionName: '在庫アイテム更新'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ 在庫アイテムを更新しました。';
  }
}
