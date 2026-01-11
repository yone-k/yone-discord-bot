import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { BaseSelectMenuHandler, SelectMenuHandlerContext } from '../base/BaseSelectMenuHandler';
import { Logger } from '../utils/logger';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindMessageManager } from '../services/RemindMessageManager';
import { formatRemindBeforeInput } from '../utils/RemindDuration';
import { RemindTask } from '../models/RemindTask';

export class RemindTaskUpdateSelectMenuHandler extends BaseSelectMenuHandler {
  private repository: RemindTaskRepository;
  private messageManager: RemindMessageManager;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    messageManager?: RemindMessageManager
  ) {
    super('remind-task-update-select', logger, operationLogService, metadataManager);
    this.repository = repository || new RemindTaskRepository();
    this.messageManager = messageManager || new RemindMessageManager();
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  public shouldHandle(context: SelectMenuHandlerContext): boolean {
    if (context.interaction.user.bot) {
      return false;
    }

    return context.interaction.customId.startsWith('remind-task-update-select:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: 'リマインド更新'
    };
  }

  protected async executeAction(context: SelectMenuHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const messageId = this.parseMessageId(context.interaction.customId);
    if (!channelId || !messageId) {
      return { success: false, message: 'チャンネル情報が取得できません' };
    }

    const selection = context.interaction.values?.[0];
    if (!selection) {
      return { success: false, message: '更新内容が選択されていません' };
    }

    const task = await this.repository.findTaskByMessageId(channelId, messageId);
    if (!task) {
      return { success: false, message: 'タスクが見つかりません' };
    }

    const modal =
      selection === 'basic'
        ? this.buildBasicModal(task, messageId)
        : selection === 'override'
          ? this.buildOverrideModal(task, messageId)
          : null;

    if (!modal) {
      return { success: false, message: '更新内容が不正です' };
    }

    await this.messageManager.updateTaskMessage(
      channelId,
      messageId,
      task,
      context.interaction.client,
      new Date()
    );
    await context.interaction.showModal(modal);

    return { success: true, message: '更新モーダルを表示しました' };
  }

  private buildBasicModal(task: RemindTask, messageId: string): ModalBuilder {
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

    return modal;
  }

  private buildOverrideModal(task: RemindTask, messageId: string): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`remind-task-update-override-modal:${messageId}`)
      .setTitle('期限上書き');

    const lastDoneValue = task.lastDoneAt ? this.formatTokyoDateTime(task.lastDoneAt) : '';
    const nextDueValue = this.formatTokyoDateTime(task.nextDueAt);

    const lastDoneInput = new TextInputBuilder()
      .setCustomId('last-done-at')
      .setLabel('前回完了日（YYYY/MM/DD もしくは YYYY/MM/DD HH:MM）')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(16);

    if (lastDoneValue) {
      lastDoneInput.setValue(lastDoneValue);
    }

    const nextDueInput = new TextInputBuilder()
      .setCustomId('next-due-at')
      .setLabel('次回期限（YYYY/MM/DD もしくは YYYY/MM/DD HH:MM）')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(16)
      .setValue(nextDueValue);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(lastDoneInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(nextDueInput)
    );

    return modal;
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length === 2 ? parts[1] : null;
  }

  private formatTokyoDateTime(date: Date): string {
    const tokyoOffset = 9 * 60;
    const tokyoDate = new Date(date.getTime() + tokyoOffset * 60 * 1000);
    const year = tokyoDate.getUTCFullYear();
    const month = String(tokyoDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(tokyoDate.getUTCDate()).padStart(2, '0');
    const hours = String(tokyoDate.getUTCHours()).padStart(2, '0');
    const minutes = String(tokyoDate.getUTCMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
  }
}
