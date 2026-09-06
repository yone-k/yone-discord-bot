import { Logger } from '../utils/logger';
import type { InventoryItem } from '../models/InventoryItem';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import {
  parseCompletionInput
} from '../utils/RemindInventory';
import { InventoryRepository } from '../services/InventoryRepository';
import { InventoryMessageManager } from '../services/InventoryMessageManager';
import { RemindTaskRefreshService } from '../services/RemindTaskRefreshService';

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

interface InventoryMessageManagerPort {
  createOrUpdateMessage(
    channelId: string,
    items: InventoryItem[],
    listTitle: string,
    client: ModalHandlerContext['interaction']['client']
  ): Promise<{ success: boolean; errorMessage?: string }>;
}

interface RefreshServicePort {
  refreshTasksUsingInventory(
    linkedInventoryChannelId: string,
    client: ModalHandlerContext['interaction']['client'],
    options: { excludeMessageId?: string }
  ): Promise<void>;
}

export class RemindTaskCompleteModalHandler extends BaseModalHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;
  private inventoryRepository?: InventoryRepositoryPort;
  private inventoryMessageManager?: InventoryMessageManagerPort;
  private refreshService?: RefreshServicePort;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager,
    inventoryRepository?: InventoryRepositoryPort,
    inventoryMessageManager?: InventoryMessageManagerPort,
    refreshService?: RefreshServicePort
  ) {
    super('remind-task-complete-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
    this.inventoryRepository = inventoryRepository;
    this.inventoryMessageManager = inventoryMessageManager;
    this.refreshService = refreshService;
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId.startsWith('remind-task-complete-modal:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'complete',
      actionName: 'リマインド完了'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ 完了として登録しました。';
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const messageId = this.parseMessageId(context.interaction.customId);
    if (!channelId || !messageId) {
      return { success: false, message: 'チャンネル情報が取得できません' };
    }

    const task = await this.repository.findTaskByMessageId(channelId, messageId);
    if (!task) {
      return { success: false, message: 'タスクが見つかりません' };
    }

    const metadataResult = await this.metadataManager?.getChannelMetadata(channelId);
    const linkedInventoryChannelId = (metadataResult?.metadata as { linkedInventoryChannelId?: string } | undefined)
      ?.linkedInventoryChannelId;
    if (!linkedInventoryChannelId) {
      return { success: false, message: '在庫チャンネルが連携されていません' };
    }

    let completionInput: Array<{ name: string; consume: string | null }>;
    try {
      completionInput = parseCompletionInput(
        context.interaction.fields.getTextInputValue('inventory-items')
      );
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '完了入力の形式が不正です'
      };
    }

    const expectedRevision = context.interaction.customId.split(':')[2];
    if (!expectedRevision) return { success: false, message: 'タスクが変更されました。開き直してください。' };
    let completionSaved = false;
    try {
      const latest = await this.repository.complete(channelId, { ...task, revision: expectedRevision }, completionInput);
      completionSaved = true;
      const rendered = await this.messageManager.updateTaskMessage(channelId, messageId, latest, context.interaction.client, new Date());
      if (!rendered.success) throw new Error('表示更新に失敗しました');
    } catch (error) {
      return { success: false, message: completionSaved ? '完了は保存されましたが表示更新に失敗しました。完了操作を繰り返さず、初期化で再表示してください。' : error instanceof Error ? error.message : '完了結果を確認できません。画面を開き直してください。' };
    } finally {
      if (completionSaved) await this.refreshInventoryMessage({ linkedInventoryChannelId }, context.interaction.client, messageId);
    }

    return { success: true };
  }

  private async refreshInventoryMessage(
    inventoryResult: { linkedInventoryChannelId?: string },
    client: ModalHandlerContext['interaction']['client'],
    messageId: string
  ): Promise<void> {
    if (!inventoryResult.linkedInventoryChannelId) {
      return;
    }

    const channelId = inventoryResult.linkedInventoryChannelId;
    try {
      const inventoryRepository = this.inventoryRepository ?? new InventoryRepository();
      const inventoryMessageManager = this.inventoryMessageManager ?? InventoryMessageManager.getInstance();
      const items = await inventoryRepository.fetchAll(channelId);
      const result = await inventoryMessageManager.createOrUpdateMessage(channelId, items, '在庫リスト', client);
      if (!result.success) {
        this.logger.warn('Failed to refresh inventory message after task completion', {
          channelId,
          error: result.errorMessage
        });
      }
      try {
        await this.getRefreshService().refreshTasksUsingInventory(channelId, client, { excludeMessageId: messageId });
      } catch (error) {
        this.logger.warn('Failed to refresh task messages after inventory consumption', {
          channelId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } catch (error) {
      this.logger.warn('Failed to refresh inventory message after task completion', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private getRefreshService(): RefreshServicePort {
    if (!this.refreshService) {
      this.refreshService = new RemindTaskRefreshService();
    }
    return this.refreshService;
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length >= 2 && parts[1] ? parts[1] : null;
  }

}
