import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseSelectMenuHandler, SelectMenuHandlerContext } from '../base/BaseSelectMenuHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import type { MetadataProvider } from '../services/MetadataProvider';
import type { OperationLogService } from '../services/OperationLogService';
import { InventoryRepository } from '../services/InventoryRepository';
import { Logger } from '../utils/logger';

interface InventoryRepositoryPort {
  findById(channelId: string, id: string): Promise<InventoryItem | null>;
}

export class InventoryUpdateSelectMenuHandler extends BaseSelectMenuHandler {
  private readonly repository: InventoryRepositoryPort;

  constructor(
    logger: Logger,
    repository: InventoryRepositoryPort = new InventoryRepository(),
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    super('inventory_update_select', logger, operationLogService, metadataManager);
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
    return { success: true, message: '在庫更新モーダルを表示しました' };
  }

  protected getOperationInfo(_context: SelectMenuHandlerContext): OperationInfo {
    return {
      operationType: 'update',
      actionName: '在庫アイテム更新'
    };
  }

  private buildModal(item: InventoryItem): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`inventory_update_modal_${item.id}`)
      .setTitle('在庫を更新');

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('名前')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100)
      .setValue(item.name);

    const stockInput = new TextInputBuilder()
      .setCustomId('stock')
      .setLabel('在庫数')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(20)
      .setValue(String(item.stock));

    const categoryInput = new TextInputBuilder()
      .setCustomId('category')
      .setLabel('カテゴリー')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(50)
      .setValue(item.category);

    return modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(stockInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput)
    );
  }
}
