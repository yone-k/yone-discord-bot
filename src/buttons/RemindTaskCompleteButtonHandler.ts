import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';

export class RemindTaskCompleteButtonHandler extends BaseButtonHandler {
  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    super('remind-task-complete', logger, operationLogService, metadataManager);
    this.ephemeral = true;
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
    const messageId = context.interaction.message?.id;
    if (!messageId) {
      return { success: false, message: 'メッセージが取得できません' };
    }

    const modal = new ModalBuilder()
      .setCustomId(`remind-task-complete-modal:${messageId}`)
      .setTitle('完了確認');

    const memoInput = new TextInputBuilder()
      .setCustomId('memo')
      .setLabel('メモ（任意）')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(400);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(memoInput));

    await context.interaction.showModal(modal);

    return { success: true, message: '完了モーダルを表示しました' };
  }
}
