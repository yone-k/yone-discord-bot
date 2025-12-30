import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, ComponentType, MessageFlags, TextChannel } from 'discord.js';
import type { Message } from 'discord.js';
import type {
  APIActionRowComponent,
  APIComponentInContainer,
  APIComponentInMessageActionRow,
  APIMessageTopLevelComponent,
  APITextDisplayComponent
} from 'discord-api-types/v10';
import { GoogleSheetsService, OperationResult } from './GoogleSheetsService';
import { RemindTask } from '../models/RemindTask';
import { RemindTaskFormatter } from '../ui/RemindTaskFormatter';

export interface RemindMessageResult extends OperationResult {
  messageId?: string;
}

export interface RemindThreadResult extends OperationResult {
  threadId?: string;
  parentMessageId?: string;
}

export interface RemindMessageManagerOptions {
  sheetUrlResolver?: (channelId: string) => Promise<string>;
}

export class RemindMessageManager {
  private sheetUrlResolver: (channelId: string) => Promise<string>;

  constructor(options: RemindMessageManagerOptions = {}) {
    this.sheetUrlResolver = options.sheetUrlResolver ?? this.resolveSheetUrl.bind(this);
  }

  public async sendReminderToThread(
    channelId: string,
    threadId: string | undefined,
    parentMessageId: string | undefined,
    content: string,
    client: Client,
    threadName: string = '通知用スレッド'
  ): Promise<RemindThreadResult> {
    const ensureResult = await this.ensureReminderThread(
      channelId,
      client,
      threadId,
      parentMessageId,
      threadName
    );
    if (!ensureResult.success || !ensureResult.threadId || !ensureResult.parentMessageId) {
      return { success: false, message: ensureResult.message };
    }

    const threadChannel = await client.channels.fetch(ensureResult.threadId);
    if (!threadChannel || !threadChannel.isThread()) {
      return { success: false, message: 'Thread not found' };
    }

    if (threadChannel.archived) {
      try {
        await threadChannel.setArchived(false);
      } catch {
        // ignore unarchive failures
      }
    }

    await threadChannel.send(content);
    return {
      success: true,
      threadId: ensureResult.threadId,
      parentMessageId: ensureResult.parentMessageId
    };
  }

  public async ensureReminderThread(
    channelId: string,
    client: Client,
    threadId?: string,
    parentMessageId?: string,
    threadName: string = '通知用スレッド'
  ): Promise<RemindThreadResult> {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { success: false, message: 'Channel not found' };
    }

    const textChannel = channel as TextChannel;
    if (threadId) {
      const existingThread = await client.channels.fetch(threadId);
      if (existingThread && existingThread.isThread()) {
        if (existingThread.archived) {
          try {
            await existingThread.setArchived(false);
          } catch {
            // ignore unarchive failures and try to send anyway
          }
        }
        if (parentMessageId) {
          try {
            const parentMessage = await textChannel.messages.fetch(parentMessageId);
            await this.ensureNoticeMessageState(parentMessage, channelId);
            return { success: true, threadId: existingThread.id, parentMessageId };
          } catch {
            // fall through to recreate thread
          }
        } else {
          // parent message is unknown; recreate to ensure the message exists
        }
      }
    }

    const noticeComponents = await this.buildNoticeMessageComponents(channelId);
    const parentMessage = await textChannel.send({
      flags: MessageFlags.IsComponentsV2,
      components: noticeComponents
    });

    try {
      await parentMessage.pin();
    } catch {
      // ignore pin failures
    }

    const thread = await parentMessage.startThread({
      name: threadName,
      autoArchiveDuration: 1440
    });

    return { success: true, threadId: thread.id, parentMessageId: parentMessage.id };
  }

  public async createTaskMessage(
    channelId: string,
    task: RemindTask,
    client: Client,
    now: Date = new Date()
  ): Promise<RemindMessageResult> {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { success: false, message: 'Channel not found' };
    }

    const message = await (channel as TextChannel).send({
      flags: MessageFlags.IsComponentsV2,
      components: this.buildMessageComponents(task, now)
    });

    return { success: true, messageId: message.id };
  }

  public async updateTaskMessage(
    channelId: string,
    messageId: string,
    task: RemindTask,
    client: Client,
    now: Date = new Date()
  ): Promise<OperationResult> {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { success: false, message: 'Channel not found' };
    }

    const message = await (channel as TextChannel).messages.fetch(messageId);
    await message.edit({
      content: null,
      embeds: [],
      flags: MessageFlags.IsComponentsV2,
      components: this.buildMessageComponents(task, now)
    });

    return { success: true };
  }

  public async deleteTaskMessage(
    channelId: string,
    messageId: string,
    client: Client
  ): Promise<OperationResult> {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { success: false, message: 'Channel not found' };
    }

    const message = await (channel as TextChannel).messages.fetch(messageId);
    await message.delete();
    return { success: true };
  }

  private buildActionRow(): ActionRowBuilder<ButtonBuilder> {
    const detailButton = new ButtonBuilder()
      .setCustomId('remind-task-detail')
      .setLabel('詳細')
      .setStyle(ButtonStyle.Secondary);

    const updateButton = new ButtonBuilder()
      .setCustomId('remind-task-update')
      .setLabel('更新')
      .setStyle(ButtonStyle.Primary);

    const completeButton = new ButtonBuilder()
      .setCustomId('remind-task-complete')
      .setLabel('完了')
      .setStyle(ButtonStyle.Success);

    const deleteButton = new ButtonBuilder()
      .setCustomId('remind-task-delete')
      .setLabel('削除')
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder<ButtonBuilder>()
      .addComponents(detailButton, updateButton, completeButton, deleteButton);
  }

  private buildNoticeActionRow(): ActionRowBuilder<ButtonBuilder> {
    const addButton = new ButtonBuilder()
      .setCustomId('remind-task-add')
      .setLabel('新規作成')
      .setStyle(ButtonStyle.Primary);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(addButton);
  }

  private async ensureNoticeMessageState(parentMessage: Message, channelId: string): Promise<void> {
    const components = Array.isArray(parentMessage.components) ? parentMessage.components : [];
    const hasAddButton = this.hasCustomId(components, 'remind-task-add');
    const textContents = this.collectTextContents(components);
    const hasTitle = textContents.some((content) => content.includes('通知用スレッド'));
    const hasSheetLink = textContents.some((content) => content.includes('スプレッドシートを開く'));
    const hasV2Flag = typeof parentMessage.flags?.has === 'function'
      ? parentMessage.flags.has(MessageFlags.IsComponentsV2)
      : false;
    if (hasAddButton && hasTitle && hasSheetLink && hasV2Flag) {
      return;
    }

    if (typeof parentMessage.edit !== 'function') {
      return;
    }

    const noticeComponents = await this.buildNoticeMessageComponents(channelId);
    await parentMessage.edit({
      content: null,
      embeds: [],
      flags: MessageFlags.IsComponentsV2,
      components: noticeComponents
    });
  }

  private async buildNoticeMessageComponents(channelId: string): Promise<APIMessageTopLevelComponent[]> {
    const spreadsheetUrl = await this.sheetUrlResolver(channelId);
    const containerComponents: APIComponentInContainer[] = [
      this.buildTextDisplay('### 通知用スレッド')
    ];

    if (spreadsheetUrl) {
      containerComponents.push(this.buildTextDisplay(`[スプレッドシートを開く](${spreadsheetUrl})`));
    }

    containerComponents.push(this.buildNoticeActionRow().toJSON() as APIActionRowComponent<APIComponentInMessageActionRow>);

    return [{
      type: ComponentType.Container,
      components: containerComponents
    }];
  }

  private hasCustomId(components: unknown[], customId: string): boolean {
    let found = false;
    const visit = (value: unknown): void => {
      if (found || !value || typeof value !== 'object') {
        return;
      }
      const record = value as Record<string, unknown>;
      const currentId = record.customId ?? record.custom_id;
      if (currentId === customId) {
        found = true;
        return;
      }
      const nested = record.components;
      if (Array.isArray(nested)) {
        nested.forEach(visit);
      }
    };
    components.forEach(visit);
    return found;
  }

  private collectTextContents(components: unknown[]): string[] {
    const texts: string[] = [];
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') {
        return;
      }
      const record = value as Record<string, unknown>;
      if (typeof record.content === 'string') {
        texts.push(record.content);
      }
      const nested = record.components;
      if (Array.isArray(nested)) {
        nested.forEach(visit);
      }
    };
    components.forEach(visit);
    return texts;
  }

  private async resolveSheetUrl(channelId: string): Promise<string> {
    if (process.env.NODE_ENV === 'test') {
      return 'https://docs.google.com/spreadsheets/d/test-spreadsheet-id/edit#gid=0';
    }

    try {
      const googleSheetsService = GoogleSheetsService.getInstance();
      const spreadsheetId = (googleSheetsService as unknown as { config?: { spreadsheetId: string } }).config?.spreadsheetId;
      if (!spreadsheetId) {
        return '';
      }

      const sheetName = `remind_list_${channelId}`;
      try {
        const sheetMetadata = await googleSheetsService.getSheetMetadataByName(sheetName);
        return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetMetadata.sheetId}`;
      } catch {
        return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Missing required environment variables')) {
        return '';
      }
    }

    return '';
  }

  private buildMessageComponents(task: RemindTask, now: Date): APIMessageTopLevelComponent[] {
    const summary = RemindTaskFormatter.formatSummaryText(task, now);
    const progressBlock = `\`\`\`\n${summary.progressBar}\n\`\`\``;
    const containerComponents: APIComponentInContainer[] = [
      this.buildTextDisplay(`## ${task.title}`),
      this.buildTextDisplay(progressBlock)
    ];

    if (summary.detailsText) {
      containerComponents.push(this.buildTextDisplay(summary.detailsText));
    }

    containerComponents.push(this.buildActionRow().toJSON() as APIActionRowComponent<APIComponentInMessageActionRow>);

    return [{
      type: ComponentType.Container,
      components: containerComponents
    }];
  }

  private buildTextDisplay(content: string): APITextDisplayComponent {
    return {
      type: ComponentType.TextDisplay,
      content
    };
  }
}
