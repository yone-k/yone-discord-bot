import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { MetadataProvider } from '../services/MetadataProvider';
import { OperationLogService } from '../services/OperationLogService';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { Logger } from '../utils/logger';

export class RemindTaskUpdateOverrideButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository
  ) {
    super('remind-task-update-override', logger, operationLogService, metadataManager);
    this.repository = repository || new RemindTaskRepository();
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  public shouldHandle(context: ButtonHandlerContext): boolean {
    if (context.interaction.user.bot) {
      return false;
    }

    return context.interaction.customId.startsWith('remind-task-update-override:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: 'リマインド期限上書き'
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

    await context.interaction.showModal(modal);
    await this.deletePromptMessage(context);

    return { success: true, message: '期限上書きモーダルを表示しました' };
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length === 2 ? parts[1] : null;
  }

  private async deletePromptMessage(context: ButtonHandlerContext): Promise<void> {
    const promptMessage = context.interaction.message;
    if (!promptMessage) {
      return;
    }

    try {
      await promptMessage.delete();
    } catch {
      // ephemeralメッセージなど削除できない場合は無視する
    }
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
