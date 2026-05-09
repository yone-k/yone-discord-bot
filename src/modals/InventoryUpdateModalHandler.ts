import type { Client } from 'discord.js';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { InventoryMessageManager } from '../services/InventoryMessageManager';
import { InventoryRepository } from '../services/InventoryRepository';
import { InventoryService } from '../services/InventoryService';
import { RemindTaskRefreshService, type RefreshOptions } from '../services/RemindTaskRefreshService';
import { Logger } from '../utils/logger';

interface InventoryServicePort {
  update(channelId: string, item: InventoryItem): Promise<{ success: boolean; message?: string }>;
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
  private static readonly customIdPrefix = `${InventoryUpdateModalHandler.customId}_`;

  private readonly inventoryService: InventoryServicePort;
  private readonly messageManager: InventoryMessageManagerPort;
  private readonly repository: InventoryRepositoryPort;
  private readonly refreshService: RefreshServicePort;

  constructor(
    logger: Logger,
    inventoryService: InventoryServicePort = InventoryService.getInstance(),
    messageManager: InventoryMessageManagerPort = InventoryMessageManager.getInstance(),
    repository: InventoryRepositoryPort = new InventoryRepository(),
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
    return context.interaction.customId.startsWith(InventoryUpdateModalHandler.customIdPrefix);
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    if (!channelId) {
      return { success: false, message: 'チャンネルIDが取得できません' };
    }

    const id = this.parseInventoryId(context.interaction.customId);
    if (!id) {
      return { success: false, message: '在庫IDが取得できません' };
    }

    const name = context.interaction.fields.getTextInputValue('name').trim();
    if (!name) {
      return { success: false, message: '名前を入力してください' };
    }

    const stockText = context.interaction.fields.getTextInputValue('stock').trim();
    const stock = Number(stockText);
    if (!Number.isFinite(stock)) {
      return { success: false, message: '在庫数は数値で入力してください' };
    }

    const item: InventoryItem = {
      id,
      name,
      stock,
      category: context.interaction.fields.getTextInputValue('category').trim()
    };

    const updateResult = await this.inventoryService.update(channelId, item);
    if (!updateResult.success) {
      return { success: false, message: updateResult.message || '在庫アイテムの更新に失敗しました' };
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
      await this.refreshService.refreshTasksUsingInventory(channelId, context.interaction.client, { inventoryId: item.id });
    } catch (error) {
      this.logger.warn('Failed to refresh task messages using inventory', {
        channelId,
        inventoryId: item.id,
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

  private parseInventoryId(customId: string): string | null {
    if (!customId.startsWith(InventoryUpdateModalHandler.customIdPrefix)) {
      return null;
    }

    return customId.slice(InventoryUpdateModalHandler.customIdPrefix.length) || null;
  }
}
