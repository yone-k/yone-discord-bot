import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { MetadataProvider } from '../services/MetadataProvider';
import { OperationLogService } from '../services/OperationLogService';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { formatRemindBeforeInput } from '../utils/RemindDuration';
import { Logger } from '../utils/logger';

export class RemindTaskUpdateBasicButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager
  ) {
    super('remind-task-update-basic', logger, operationLogService, metadataManager);
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  public shouldHandle(context: ButtonHandlerContext): boolean {
    if (context.interaction.user.bot) {
      return false;
    }

    return context.interaction.customId.startsWith('remind-task-update-basic:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: 'リマインド更新'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const messageId = this.parseMessageId(context.interaction.customId);
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
      .setLabel('期限時刻（時:分）')
      .setStyle(TextInputStyle.Short)
      .setValue(task.timeOfDay)
      .setRequired(true)
      .setMaxLength(5);

    const remindInput = new TextInputBuilder()
      .setCustomId('remind-before')
      .setLabel('事前通知（日:時:分 もしくは 時:分）')
      .setStyle(TextInputStyle.Short)
      .setValue(formatRemindBeforeInput(task.remindBeforeMinutes))
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
    await this.messageManager.updateTaskMessage(
      channelId,
      messageId,
      task,
      context.interaction.client,
      new Date()
    );

    return { success: true, message: '更新モーダルを表示しました' };
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length === 2 ? parts[1] : null;
  }

}
