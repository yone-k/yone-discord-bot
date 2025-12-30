import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';

export class RemindTaskAddButtonHandler extends BaseButtonHandler {
  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    super('remind-task-add', logger, operationLogService, metadataManager);
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'add',
      actionName: 'リマインド追加'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    await this.showAddModal(context);
    return { success: true, message: '追加モーダルを表示しました' };
  }

  private async showAddModal(context: ButtonHandlerContext): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId('remind-task-add-modal')
      .setTitle('リマインド追加');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('タスク名')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('説明（任意）')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500);

    const intervalInput = new TextInputBuilder()
      .setCustomId('interval-days')
      .setLabel('周期（日）')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(4);

    const timeInput = new TextInputBuilder()
      .setCustomId('time-of-day')
      .setLabel('期限時刻（時:分）')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('00:00')
      .setRequired(false)
      .setMaxLength(5);

    const remindInput = new TextInputBuilder()
      .setCustomId('remind-before')
      .setLabel('事前通知（日:時:分 もしくは 時:分）')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(8);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(intervalInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(timeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(remindInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
    );

    await context.interaction.showModal(modal);
  }
}
