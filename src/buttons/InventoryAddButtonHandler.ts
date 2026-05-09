import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import type { MetadataProvider } from '../services/MetadataProvider';
import type { OperationLogService } from '../services/OperationLogService';
import { Logger } from '../utils/logger';

export class InventoryAddButtonHandler extends BaseButtonHandler {
  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    super('inventory_add', logger, operationLogService, metadataManager);
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    await context.interaction.showModal(this.buildModal());
    return { success: true, message: '在庫追加モーダルを表示しました' };
  }

  protected getOperationInfo(_context: ButtonHandlerContext): OperationInfo {
    return {
      operationType: 'add',
      actionName: '在庫アイテム追加'
    };
  }

  private buildModal(): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId('inventory_add_modal')
      .setTitle('在庫アイテムを追加');

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('名前')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const stockInput = new TextInputBuilder()
      .setCustomId('stock')
      .setLabel('在庫数')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(20);

    const categoryInput = new TextInputBuilder()
      .setCustomId('category')
      .setLabel('カテゴリー')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(50);

    return modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(stockInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput)
    );
  }
}
