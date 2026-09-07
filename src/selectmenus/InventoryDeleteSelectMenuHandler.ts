import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseSelectMenuHandler, SelectMenuHandlerContext } from '../base/BaseSelectMenuHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import type { MetadataProvider } from '../services/MetadataProvider';
import type { UiOperationEvents } from '../services/UiOperationEvents';
import { InventoryRepository } from '../services/InventoryRepository';
import { Logger } from '../utils/logger';

interface InventoryRepositoryPort {
  findById(channelId: string, id: string): Promise<InventoryItem | null>;
}

export class InventoryDeleteSelectMenuHandler extends BaseSelectMenuHandler {
  private readonly repository: InventoryRepositoryPort;

  constructor(
    logger: Logger,
    repository: InventoryRepositoryPort = new InventoryRepository(),
    operationLogService?: UiOperationEvents,
    metadataManager?: MetadataProvider
  ) {
    super('inventory_delete_select', logger, operationLogService, metadataManager);
    this.repository = repository;
    this.ephemeral = true;
  }

  public shouldHandle(context: SelectMenuHandlerContext): boolean {
    if (context.interaction.user.bot) {
      return false;
    }

    return context.interaction.customId === this.customId
      || context.interaction.customId.startsWith(`${this.customId}_`);
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected async executeAction(context: SelectMenuHandlerContext): Promise<OperationResult> {
    const inventoryId = context.interaction.values[0];
    const item = await this.repository.findById(context.interaction.channelId, inventoryId);

    if (!item) {
      await context.interaction.reply({
        content: '選択した在庫アイテムが見つかりません。',
        flags: ['Ephemeral']
      });
      return { success: false, message: '在庫アイテムが見つかりません' };
    }

    await context.interaction.showModal(this.buildModal(item));
    return { success: true, message: '在庫削除モーダルを表示しました' };
  }

  protected getOperationInfo(_context: SelectMenuHandlerContext): OperationInfo {
    return {
      operationType: 'delete',
      actionName: '在庫アイテム削除'
    };
  }

  private buildModal(item: InventoryItem): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`inventory_delete_modal_${item.id}`)
      .setTitle('在庫削除の確認');

    const confirmInput = new TextInputBuilder()
      .setCustomId('confirm')
      .setLabel('削除する場合は YES と入力してください')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);

    return modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput)
    );
  }
}
