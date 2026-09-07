import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { Logger } from '../utils/logger';
import { quoteCsvCell } from '../utils/Csv';
import type { InventoryItem } from '../models/InventoryItem';
import { type RemindTask } from '../models/RemindTask';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { compareDecimal } from '../utils/Decimal';
import { InventoryRepository } from '../services/InventoryRepository';

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

export class RemindTaskCompleteButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;
  private inventoryRepository?: InventoryRepositoryPort;

  constructor(
    logger: Logger,
    operationLogService?: UiOperationEvents,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    inventoryRepository?: InventoryRepositoryPort
  ) {
    super('remind-task-complete', logger, operationLogService, metadataManager);
    this.ephemeral = true;
    this.repository = repository || new RemindTaskRepository();
    this.inventoryRepository = inventoryRepository;
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

      if (this.hasVariableInventoryItem(task)) {
        return await this.showVariableConsumptionModal(interaction, channelId, messageId, task);
      }

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: ['Ephemeral'] as const });
        hasDeferredReply = true;
      }

      await this.repository.complete(channelId, task);

      try {
        await interaction.deleteReply();
      } catch {
        // ignore delete failures
      }

      return { success: true };
    } catch (error) {
      return await replyError(error instanceof Error ? error.message : '処理中にエラーが発生しました');
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

}
