import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';

export class RemindTaskDeleteButtonHandler extends BaseButtonHandler {
  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    super('remind-task-delete', logger, operationLogService, metadataManager);
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'delete',
      actionName: 'リマインド削除'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const messageId = context.interaction.message?.id;
    if (!messageId) {
      return { success: false, message: 'メッセージが取得できません' };
    }

    const modal = new ModalBuilder()
      .setCustomId(`remind-task-delete-modal:${messageId}`)
      .setTitle('削除確認');

    const confirmInput = new TextInputBuilder()
      .setCustomId('confirm')
      .setLabel('削除する場合は「削除」と入力')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput));

    await context.interaction.showModal(modal);

    return { success: true, message: '削除モーダルを表示しました' };
  }
}
