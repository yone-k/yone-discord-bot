import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';

export class RemindTaskUpdateButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository
  ) {
    super('remind-task-update', logger, operationLogService, metadataManager);
    this.repository = repository || new RemindTaskRepository();
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: 'リマインド更新'
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
      .setCustomId(`remind-task-update-modal:${messageId}`)
      .setTitle('リマインド更新');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('タスク名')
      .setStyle(TextInputStyle.Short)
      .setValue(task.title)
      .setRequired(true)
      .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('説明（任意）')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(task.description || '')
      .setRequired(false)
      .setMaxLength(500);

    const intervalInput = new TextInputBuilder()
      .setCustomId('interval-days')
      .setLabel('周期（日）')
      .setStyle(TextInputStyle.Short)
      .setValue(String(task.intervalDays))
      .setRequired(true)
      .setMaxLength(4);

    const timeInput = new TextInputBuilder()
      .setCustomId('time-of-day')
      .setLabel('期限時刻（HH:mm）')
      .setStyle(TextInputStyle.Short)
      .setValue(task.timeOfDay)
      .setRequired(true)
      .setMaxLength(5);

    const remindInput = new TextInputBuilder()
      .setCustomId('remind-before')
      .setLabel('事前通知（分）')
      .setStyle(TextInputStyle.Short)
      .setValue(String(task.remindBeforeMinutes))
      .setRequired(false)
      .setMaxLength(5);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(intervalInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(timeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(remindInput)
    );

    await context.interaction.showModal(modal);

    return { success: true, message: '更新モーダルを表示しました' };
  }
}
