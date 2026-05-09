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
      .setTitle('在庫を追加');

    const itemsInput = new TextInputBuilder()
      .setCustomId('items')
      .setLabel('名前,在庫数,カテゴリ（1行に1つ）')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('例:\n洗剤,5,日用品\nパン,3,食料品')
      .setRequired(true)
      .setMaxLength(4000);

    return modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(itemsInput)
    );
  }
}
