import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { Logger } from '../utils/logger';
import { quoteCsvCell } from '../utils/Csv';
import type { InventoryItem } from '../models/InventoryItem';
import { type RemindTask } from '../models/RemindTask';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { compareDecimal } from '../utils/Decimal';
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
    super('remind-task-complete', logger, operationLogService, metadataManager);
    this.ephemeral = true;
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
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
    let completionSaved = false;

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

      if (this.hasVariableInventoryItem(task)) {
        return await this.showVariableConsumptionModal(interaction, channelId, messageId, task);
      }

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: ['Ephemeral'] as const });
        hasDeferredReply = true;
      }

      const now = new Date();
      const latest = await this.repository.complete(channelId, task);
      completionSaved = true;
      try {
        const rendered = await this.messageManager.updateTaskMessage(channelId, messageId, latest, interaction.client, now);
        if (!rendered.success) throw new Error('表示更新に失敗しました');
      } finally {
        const metadata = await this.metadataManager?.getChannelMetadata(channelId);
        await this.refreshInventoryMessage({ linkedInventoryChannelId: metadata?.metadata?.linkedInventoryChannelId }, interaction.client, messageId);
      }

      try {
        await interaction.deleteReply();
      } catch {
        // ignore delete failures
      }

      return { success: true };
    } catch (error) {
      return await replyError(completionSaved ? '完了は保存されましたが、タスクまたは在庫の表示更新に失敗しました。完了操作を繰り返さず、初期化で再表示してください。' : error instanceof Error ? error.message : '処理中にエラーが発生しました');
    }
  }

  private hasVariableInventoryItem(task: RemindTask): boolean {
    return task.inventoryItems.some(item => compareDecimal(item.consume, '0') === 0);
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
      .setCustomId(`remind-task-complete-modal:${messageId}:${task.revision}`)
      .setTitle('完了時の消費数入力');

    const inventoryInput = new TextInputBuilder()
      .setCustomId('inventory-items')
      .setLabel('消費CSV（名前,数。都度入力必須・固定は空欄で維持）')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder('消費しない場合は0。例: "牛乳,低脂肪",0')
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
      const inventoryItem = inventoryItemsById.get(item.inventoryId);
      const name = inventoryItem?.name ?? `[不明な在庫:${item.inventoryId.slice(0, 8)}]`;
      return this.formatInventoryPrefillLine(name, item.consume);
    });
    return lines.join('\n');
  }

  private formatInventoryPrefillLine(name: string, consume: string): string {
    if (compareDecimal(consume, '0') > 0) {
      return `${quoteCsvCell(name)},${consume}`;
    }
    return `${quoteCsvCell(name)},`;
  }

  private async refreshInventoryMessage(
    inventoryResult: { linkedInventoryChannelId?: string },
    client: ButtonHandlerContext['interaction']['client'],
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

}
