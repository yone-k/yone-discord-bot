import { randomUUID } from 'node:crypto';
import { Client } from 'discord.js';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { InventoryMessageManager } from '../services/InventoryMessageManager';
import { InventoryService } from '../services/InventoryService';
import { Logger } from '../utils/logger';

interface InventoryServicePort {
  create(channelId: string, item: InventoryItem): Promise<{ success: boolean; message?: string }>;
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
  private readonly messageManager: InventoryMessageManagerPort;

  constructor(
    logger: Logger,
    inventoryService: InventoryServicePort = InventoryService.getInstance(),
    messageManager: InventoryMessageManagerPort = InventoryMessageManager.getInstance()
  ) {
    super('inventory_add_modal', logger);
    this.inventoryService = inventoryService;
    this.messageManager = messageManager;
    this.deleteOnSuccess = true;
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    if (!channelId) {
      return { success: false, message: 'チャンネルIDが取得できません' };
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

    const category = context.interaction.fields.getTextInputValue('category').trim();
    const item: InventoryItem = {
      id: randomUUID(),
      name,
      stock,
      category
    };

    const createResult = await this.inventoryService.create(channelId, item);
    if (!createResult.success) {
      return { success: false, message: createResult.message || '在庫アイテムの追加に失敗しました' };
    }

    const messageResult = await this.messageManager.createOrUpdateMessage(
      channelId,
      [item],
      '在庫リスト',
      context.interaction.client
    );
    if (!messageResult.success) {
      return { success: false, message: messageResult.errorMessage || '在庫メッセージの更新に失敗しました' };
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
