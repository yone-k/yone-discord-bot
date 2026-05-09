import { Client } from 'discord.js';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import type { InventoryChannelMetadata } from '../models/InventoryChannelMetadata';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { InventoryMessageManager } from '../services/InventoryMessageManager';
import { InventoryMetadataManager } from '../services/InventoryMetadataManager';
import { InventoryRepository } from '../services/InventoryRepository';
import { InventoryService } from '../services/InventoryService';
import type { MetadataProvider } from '../services/MetadataProvider';
import type { OperationLogService } from '../services/OperationLogService';
import { Logger } from '../utils/logger';

const CUSTOM_ID_PREFIX = 'inventory_delete_modal_';

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

interface InventoryServicePort {
  delete(channelId: string, id: string): Promise<void>;
}

interface InventoryMessageManagerPort {
  createOrUpdateMessage(
    channelId: string,
    items: InventoryItem[],
    listTitle: string,
    client: Client
  ): Promise<{ success: boolean; errorMessage?: string }>;
}

type MetadataLookupResult =
  | InventoryChannelMetadata
  | null
  | {
    success: boolean;
    metadata?: InventoryChannelMetadata;
    message?: string;
  };

interface InventoryMetadataReader {
  getChannelMetadata(channelId: string): Promise<MetadataLookupResult>;
}

export class InventoryDeleteModalHandler extends BaseModalHandler {
  private readonly metadataReader: InventoryMetadataReader;
  private readonly repository: InventoryRepositoryPort;
  private readonly inventoryService: InventoryServicePort;
  private readonly messageManager: InventoryMessageManagerPort;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager: InventoryMetadataReader = InventoryMetadataManager.getInstance(),
    repository: InventoryRepositoryPort = new InventoryRepository(),
    inventoryService: InventoryServicePort = InventoryService.getInstance(),
    messageManager: InventoryMessageManagerPort = InventoryMessageManager.getInstance()
  ) {
    super(CUSTOM_ID_PREFIX, logger, operationLogService, metadataManager as unknown as MetadataProvider);
    this.metadataReader = metadataManager;
    this.repository = repository;
    this.inventoryService = inventoryService;
    this.messageManager = messageManager;
    this.deleteOnSuccess = true;
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId.startsWith(CUSTOM_ID_PREFIX);
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    if (!channelId) {
      return { success: false, message: 'チャンネルIDが取得できません' };
    }

    const confirmation = context.interaction.fields.getTextInputValue('confirm').trim();
    if (confirmation !== 'YES') {
      return { success: false, message: '削除をキャンセルしました。' };
    }

    const inventoryId = this.extractInventoryId(context.interaction.customId);

    try {
      await this.inventoryService.delete(channelId, inventoryId);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '在庫アイテムの削除に失敗しました'
      };
    }

    const items = await this.repository.fetchAll(channelId);
    const listTitle = await this.resolveListTitle(channelId);
    const messageResult = await this.messageManager.createOrUpdateMessage(
      channelId,
      items,
      listTitle,
      context.interaction.client
    );

    if (!messageResult.success) {
      return { success: false, message: messageResult.errorMessage || '在庫メッセージの更新に失敗しました' };
    }

    return { success: true };
  }

  protected getOperationInfo(_context: ModalHandlerContext): OperationInfo {
    return {
      operationType: 'delete',
      actionName: '在庫アイテム削除'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ 在庫アイテムを削除しました。';
  }

  private extractInventoryId(customId: string): string {
    return customId.slice(CUSTOM_ID_PREFIX.length);
  }

  private async resolveListTitle(channelId: string): Promise<string> {
    const metadataResult = await this.metadataReader.getChannelMetadata(channelId);
    if (!metadataResult) {
      return '在庫リスト';
    }

    if ('success' in metadataResult) {
      return metadataResult.metadata?.listTitle || '在庫リスト';
    }

    return metadataResult.listTitle || '在庫リスト';
  }
}
