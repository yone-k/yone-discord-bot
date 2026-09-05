import { compareDecimal, formatDecimal } from '../utils/Decimal';
import { Logger } from '../utils/logger';
import type { InventoryItem } from '../models/InventoryItem';
import { type NewRemindInventoryItem } from '../models/RemindTask';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { calculateNextDueAt } from '../utils/RemindSchedule';
import {
  parseCompletionInput
} from '../utils/RemindInventory';
import { type ConsumeForTaskResult } from '../services/InventoryService';
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
        context.interaction.fields.getTextInputValue('inventory-items'), { preservePrecision: true }
      );
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '完了入力の形式が不正です'
      };
    }

    const inputMap = new Map<string, string | null>(
      completionInput.map(item => [item.name, item.consume])
    );
    const tempInventoryItems: NewRemindInventoryItem[] = [];
    const inventoryRepository = this.inventoryRepository ?? new InventoryRepository();
    const inventoryItems = await inventoryRepository.fetchAll(linkedInventoryChannelId);
    const inventoryItemMap = new Map<string, InventoryItem>(
      inventoryItems.map(item => [item.id, item])
    );
    const taskInventoryNames = new Set(task.inventoryItems.map(item => inventoryItemMap.get(item.inventoryId)?.name));
    for (const input of completionInput) {
      if (!taskInventoryNames.has(input.name)) return { success: false, message: `タスクの在庫設定にないアイテムです: ${input.name}` };
    }

    for (const item of task.inventoryItems) {
      const inventoryItem = inventoryItemMap.get(item.inventoryId);
      if (!inventoryItem) {
        if (compareDecimal(item.consume, '0') > 0) {
          tempInventoryItems.push({ inventoryId: item.inventoryId, consume: item.consume });
        }
        continue;
      }

      const input = inputMap.get(inventoryItem.name);
      try {
        const effectiveConsume = this.resolveEffectiveConsume(item.consume, input);
        tempInventoryItems.push({ inventoryId: item.inventoryId, consume: effectiveConsume });
      } catch (error) {
        return { success: false, message: `${inventoryItem.name}: ${(error as Error).message}` };
      }
    }

    const now = new Date();
    const nextDueAt = calculateNextDueAt(
      {
        intervalDays: task.intervalDays,
        timeOfDay: task.timeOfDay,
        startAt: task.startAt,
        lastDoneAt: now
      },
      now
    );

    const updatedTask = {
      ...task,
      inventoryItems: task.inventoryItems,
      lastDoneAt: now,
      nextDueAt,
      lastRemindDueAt: null,
      overdueNotifyCount: 0,
      lastOverdueNotifiedAt: null,
      updatedAt: now
    };

    const expectedRevision = context.interaction.customId.split(':')[2];
    if (!expectedRevision || task.revision !== expectedRevision) return { success: false, message: 'タスクが変更されました。開き直してください。' };
    try {
      await this.repository.complete(channelId, task, now, nextDueAt, tempInventoryItems);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '完了に失敗しました' };
    }
    const latest = await this.repository.findTaskByMessageId(channelId, messageId);
    await this.messageManager.updateTaskMessage(channelId, messageId, latest ?? updatedTask, context.interaction.client, now);
    await this.refreshInventoryMessage({ kind: 'success', linkedInventoryChannelId }, context.interaction.client, messageId);

    return { success: true };
  }

  private resolveEffectiveConsume(originalConsume: string, input: string | null | undefined): string {
    if (input === null || input === undefined) {
      if (compareDecimal(originalConsume, '0') === 0) throw new Error('今回の消費数を入力してください');
      return originalConsume;
    }
    if (compareDecimal(input, originalConsume) === 0) return originalConsume;
    return formatDecimal(input);
  }

  private async refreshInventoryMessage(
    inventoryResult: ConsumeForTaskResult,
    client: ModalHandlerContext['interaction']['client'],
    messageId: string
  ): Promise<void> {
    if (inventoryResult.kind !== 'success' || !inventoryResult.linkedInventoryChannelId) {
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
