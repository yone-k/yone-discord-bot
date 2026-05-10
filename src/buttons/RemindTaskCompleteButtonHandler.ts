import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { Logger } from '../utils/logger';
import type { InventoryItem } from '../models/InventoryItem';
import { isNewInventoryItem, type RemindTask } from '../models/RemindTask';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
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
    client: ButtonHandlerContext['interaction']['client']
  ): Promise<{ success: boolean; errorMessage?: string }>;
}

interface RefreshServicePort {
  refreshTasksUsingInventory(
    linkedInventoryChannelId: string,
    client: ButtonHandlerContext['interaction']['client'],
    options: { excludeMessageId?: string }
  ): Promise<void>;
}

export class RemindTaskCompleteButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;
  private inventoryService?: Pick<InventoryService, 'consumeForTask' | 'getById'>;
  private inventoryRepository?: InventoryRepositoryPort;
  private inventoryMessageManager?: InventoryMessageManagerPort;
  private refreshService?: RefreshServicePort;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager,
    inventoryService?: Pick<InventoryService, 'consumeForTask' | 'getById'>,
    inventoryRepository?: InventoryRepositoryPort,
    inventoryMessageManager?: InventoryMessageManagerPort,
    refreshService?: RefreshServicePort
  ) {
    super('remind-task-complete', logger, operationLogService, metadataManager);
    this.ephemeral = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
    this.inventoryService = inventoryService ?? (process.env.NODE_ENV === 'test' ? undefined : InventoryService.getInstance());
    this.inventoryRepository = inventoryRepository;
    this.inventoryMessageManager = inventoryMessageManager;
    this.refreshService = refreshService;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'complete',
      actionName: 'リマインド完了'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const interaction = context.interaction;
    let hasDeferredReply = Boolean(interaction.deferred);

    const replyError = async (message: string): Promise<OperationResult> => {
      try {
        if (hasDeferredReply || interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: message });
        } else {
          await interaction.reply({ content: message, flags: ['Ephemeral'] as const });
        }
      } catch {
        // ignore reply failures
      }
      return { success: false, message };
    };

    try {
      const channelId = interaction.channelId;
      const messageId = interaction.message?.id;
      if (!channelId || !messageId) {
        return await replyError('チャンネル情報が取得できません');
      }

      const task = await this.repository.findTaskByMessageId(channelId, messageId);
      if (!task) {
        return await replyError('タスクが見つかりません');
      }

      if (this.hasVariableInventoryItem(task) && this.metadataManager && this.inventoryService?.getById) {
        return await this.showVariableConsumptionModal(interaction, channelId, messageId, task);
      }

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: ['Ephemeral'] as const });
        hasDeferredReply = true;
      }

      let consumedInventory = task.inventoryItems;
      let nextInsufficientItems = getInsufficientInventoryItems(consumedInventory);
      if (this.inventoryService) {
        const inventoryResult = await this.inventoryService.consumeForTask(channelId, task);
        const blockedMessage = this.toBlockedMessage(task.title, inventoryResult);
        if (blockedMessage) {
          return await replyError(blockedMessage);
        }
        await this.refreshInventoryMessage(inventoryResult, interaction.client, messageId);
        nextInsufficientItems = [];
      } else {
        const insufficientItems = getInsufficientInventoryItems(task.inventoryItems);
        if (insufficientItems.length > 0) {
          const shortageNotice = formatInventoryShortageNotice(insufficientItems);
          return await replyError(`${task.title}の完了に必要な在庫が不足しています。\n${shortageNotice}`);
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
        return await replyError(updateResult.message || '更新に失敗しました');
      }

      await this.messageManager.updateTaskMessage(channelId, messageId, updatedTask, interaction.client, now);

      if (nextInsufficientItems.length > 0) {
        const shortageNotice = formatInventoryShortageNotice(nextInsufficientItems);
        await this.notifyInventory(
          channelId,
          `@everyone ${task.title}の次回分に必要な在庫が不足しています。\n${shortageNotice}`,
          interaction.client
        );
      }

      try {
        await interaction.deleteReply();
      } catch {
        // ignore delete failures
      }

      return { success: true };
    } catch {
      return await replyError('処理中にエラーが発生しました');
    }
  }

  private hasVariableInventoryItem(task: RemindTask): boolean {
    return task.inventoryItems.some(item => isNewInventoryItem(item) && item.consume === 0);
  }

  private async showVariableConsumptionModal(
    interaction: ButtonHandlerContext['interaction'],
    channelId: string,
    messageId: string,
    task: RemindTask
  ): Promise<OperationResult> {
    const metadataResult = await this.metadataManager?.getChannelMetadata(channelId);
    const linkedInventoryChannelId = (metadataResult?.metadata as { linkedInventoryChannelId?: string } | undefined)
      ?.linkedInventoryChannelId;
    if (!linkedInventoryChannelId) {
      const message = '在庫チャンネルが連携されていません';
      await interaction.reply({ content: message, flags: ['Ephemeral'] as const });
      return { success: false, message };
    }

    const prefill = await this.buildVariableConsumptionPrefill(linkedInventoryChannelId, task);
    const modal = new ModalBuilder()
      .setCustomId(`remind-task-complete-modal:${messageId}:${Date.now()}`)
      .setTitle('完了時の消費数入力');

    const inventoryInput = new TextInputBuilder()
      .setCustomId('inventory-items')
      .setLabel('消費数(名前,数 の形式 / 空欄でスキップor固定値)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder('例: 洗剤,2.5')
      .setMaxLength(1000)
      .setValue(prefill);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(inventoryInput)
    );

    await interaction.showModal(modal);
    return { success: true };
  }

  private async buildVariableConsumptionPrefill(linkedInventoryChannelId: string, task: RemindTask): Promise<string> {
    const inventoryRepository = this.inventoryRepository ?? new InventoryRepository();
    const inventoryItems = await inventoryRepository.fetchAll(linkedInventoryChannelId);
    const inventoryItemsById = new Map(inventoryItems.map(inventoryItem => [inventoryItem.id, inventoryItem]));

    const lines = task.inventoryItems.map((item) => {
      if (!isNewInventoryItem(item)) {
        return this.formatInventoryPrefillLine(item.name, item.consume);
      }

      const inventoryItem = inventoryItemsById.get(item.inventoryId);
      const name = inventoryItem?.name ?? `[不明な在庫:${item.inventoryId.slice(0, 8)}]`;
      return this.formatInventoryPrefillLine(name, item.consume);
    });
    return lines.join('\n');
  }

  private formatInventoryPrefillLine(name: string, consume: number): string {
    if (consume > 0) {
      return `${name},${consume}`;
    }
    return `${name},`;
  }

  private async notifyInventory(channelId: string, message: string, client: ButtonHandlerContext['interaction']['client']): Promise<void> {
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
    client: ButtonHandlerContext['interaction']['client'],
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

  private toBlockedMessage(title: string, result: ConsumeForTaskResult): string | null {
    if (result.kind === 'success') {
      return null;
    }
    if (result.kind === 'migration_required') {
      return '在庫移行が必要です。先に在庫移行を実行してください。';
    }
    if (result.kind === 'error') {
      return `在庫の更新に失敗しました: ${result.message}`;
    }

    const shortageNotice = formatInventoryShortageNotice(result.items as never);
    return `${title}の完了に必要な在庫が不足しています。\n${shortageNotice}`;
  }
}
