import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindTaskFormatter } from '../ui/RemindTaskFormatter';

export class RemindTaskDetailButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository
  ) {
    super('remind-task-detail', logger, operationLogService, metadataManager);
    this.ephemeral = true;
    this.repository = repository || new RemindTaskRepository();
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'detail',
      actionName: 'リマインド詳細'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const messageId = context.interaction.message?.id;
    if (!channelId || !messageId) {
      return { success: false, message: 'チャンネル情報が取得できません' };
    }

    const task = await this.repository.findTaskByMessageId(channelId, messageId);
    if (!task) {
      return { success: false, message: 'タスクが見つかりません' };
    }

    const modal = new ModalBuilder()
      .setCustomId(`remind-task-detail-modal:${messageId}`)
      .setTitle('リマインド詳細');

    const detailText = RemindTaskFormatter.formatDetailText(task, new Date());
    const descriptionText = task.description?.trim() || '（なし）';

    const detailInput = new TextInputBuilder()
      .setCustomId('detail-info')
      .setLabel('詳細')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(detailText)
      .setRequired(false)
      .setMaxLength(1000);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('detail-description')
      .setLabel('説明')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(descriptionText)
      .setRequired(false)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(detailInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
    );

    await context.interaction.showModal(modal);

    return { success: true };
  }
}
