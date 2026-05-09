import { Logger } from '../utils/logger';
import type { InventoryItem } from '../models/InventoryItem';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { calculateNextDueAt } from '../utils/RemindSchedule';
import {
  consumeInventory,
  formatInventoryShortageNotice,
  getInsufficientInventoryItems
} from '../utils/RemindInventory';
import { InventoryService, type ConsumeForTaskResult } from '../services/InventoryService';
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
  private inventoryService?: Pick<InventoryService, 'consumeForTask'>;
  private inventoryRepository?: InventoryRepositoryPort;
  private inventoryMessageManager?: InventoryMessageManagerPort;
  private refreshService?: RefreshServicePort;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager,
    inventoryService?: Pick<InventoryService, 'consumeForTask'>,
    inventoryRepository?: InventoryRepositoryPort,
    inventoryMessageManager?: InventoryMessageManagerPort,
    refreshService?: RefreshServicePort
  ) {
    super('remind-task-complete-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
    this.inventoryService = inventoryService ?? (process.env.NODE_ENV === 'test' ? undefined : InventoryService.getInstance());
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

    let consumedInventory = task.inventoryItems;
    let nextInsufficientItems = getInsufficientInventoryItems(consumedInventory);
    if (this.inventoryService) {
      const inventoryResult = await this.inventoryService.consumeForTask(channelId, task);
      const blockedResult = this.toBlockedResult(task.title, inventoryResult);
      if (blockedResult) {
        return blockedResult;
      }
      await this.refreshInventoryMessage(inventoryResult, context.interaction.client, messageId);
      nextInsufficientItems = [];
    } else {
      const insufficientItems = getInsufficientInventoryItems(task.inventoryItems);
      if (insufficientItems.length > 0) {
        const shortageNotice = formatInventoryShortageNotice(insufficientItems);
        return {
          success: false,
          message: `${task.title}の完了に必要な在庫が不足しています。\n${shortageNotice}`
        };
      }

      consumedInventory = consumeInventory(task.inventoryItems);
      nextInsufficientItems = getInsufficientInventoryItems(consumedInventory);
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
      inventoryItems: consumedInventory,
      lastDoneAt: now,
      nextDueAt,
      lastRemindDueAt: null,
      overdueNotifyCount: 0,
      lastOverdueNotifiedAt: null,
      updatedAt: now
    };

    const updateResult = await this.repository.updateTask(channelId, updatedTask);
    if (!updateResult.success) {
      return { success: false, message: updateResult.message };
    }

    await this.messageManager.updateTaskMessage(channelId, messageId, updatedTask, context.interaction.client, now);

    if (nextInsufficientItems.length > 0) {
      const shortageNotice = formatInventoryShortageNotice(nextInsufficientItems);
      await this.notifyInventory(
        channelId,
        `@everyone ${task.title}の次回分に必要な在庫が不足しています。\n${shortageNotice}`,
        context.interaction.client
      );
    }

    return { success: true };
  }

  private async notifyInventory(channelId: string, message: string, client: ModalHandlerContext['interaction']['client']): Promise<void> {
    if (!this.metadataManager) {
      return;
    }

    const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
    if (!metadataResult.success || !metadataResult.metadata) {
      return;
    }

    const { remindNoticeThreadId, remindNoticeMessageId } = metadataResult.metadata;
    await this.messageManager.sendReminderToThread(
      channelId,
      remindNoticeThreadId,
      remindNoticeMessageId,
      message,
      client
    );
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
    return parts.length === 2 ? parts[1] : null;
  }

  private toBlockedResult(title: string, result: ConsumeForTaskResult): OperationResult | null {
    if (result.kind === 'success') {
      return null;
    }
    if (result.kind === 'migration_required') {
      return {
        success: false,
        message: '在庫移行が必要です。先に在庫移行を実行してください。'
      };
    }

    const shortageNotice = formatInventoryShortageNotice(result.items as never);
    return {
      success: false,
      message: `${title}の完了に必要な在庫が不足しています。\n${shortageNotice}`
    };
  }
}
