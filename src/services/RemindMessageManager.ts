import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, ComponentType, MessageFlags, TextChannel } from 'discord.js';
import type {
  APIActionRowComponent,
  APIComponentInContainer,
  APIComponentInMessageActionRow,
  APIMessageTopLevelComponent,
  APITextDisplayComponent
} from 'discord-api-types/v10';
import { OperationResult } from './GoogleSheetsService';
import { RemindTask } from '../models/RemindTask';
import { RemindTaskFormatter } from '../ui/RemindTaskFormatter';

export interface RemindMessageResult extends OperationResult {
  messageId?: string;
}

export interface RemindThreadResult extends OperationResult {
  threadId?: string;
  parentMessageId?: string;
}

export class RemindMessageManager {
  public async sendReminderToThread(
    channelId: string,
    threadId: string | undefined,
    parentMessageId: string | undefined,
    content: string,
    client: Client,
    threadName: string = 'リマインド通知'
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
    threadName: string = 'リマインド通知'
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
            await textChannel.messages.fetch(parentMessageId);
            return { success: true, threadId: existingThread.id, parentMessageId };
          } catch {
            // fall through to recreate thread
          }
        } else {
          // parent message is unknown; recreate to ensure the message exists
        }
      }
    }

    const parentMessage = await textChannel.send({
      content: 'リマインド通知'
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
