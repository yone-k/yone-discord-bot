import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import type { InventoryChannelMetadata } from '../models/InventoryChannelMetadata';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { InventoryChannelStore } from '../services/InventoryChannelStore';
import { InventoryService } from '../services/InventoryService';
import type { MetadataProvider } from '../services/MetadataProvider';
import type { UiOperationEvents } from '../services/UiOperationEvents';
import { Logger } from '../utils/logger';

const CUSTOM_ID_PREFIX = 'inventory_delete_modal_';


interface InventoryServicePort {
  delete(channelId: string, id: string): Promise<void>;
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
  private readonly inventoryService: InventoryServicePort;

  constructor(
    logger: Logger,
    operationLogService?: UiOperationEvents,
    metadataManager: InventoryMetadataReader = InventoryChannelStore.getInstance(),
    inventoryService: InventoryServicePort = InventoryService.getInstance()
  ) {
    super(CUSTOM_ID_PREFIX, logger, operationLogService, metadataManager as unknown as MetadataProvider);
    this.inventoryService = inventoryService;
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

}
