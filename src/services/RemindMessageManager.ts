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

export class RemindMessageManager {
  public async sendReminderToThread(
    channelId: string,
    messageId: string,
    content: string,
    client: Client,
    threadName: string = 'リマインド通知'
  ): Promise<OperationResult> {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { success: false, message: 'Channel not found' };
    }

    const message = await (channel as TextChannel).messages.fetch(messageId);
    let thread = message.thread;

    if (!thread && message.hasThread) {
      const refreshedMessage = await message.fetch();
      thread = refreshedMessage.thread;
    }

    if (!thread) {
      thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 1440
      });
    } else if (thread.archived) {
      try {
        await thread.setArchived(false);
      } catch {
        // ignore unarchive failures and try to send anyway
      }
    }

    await thread.send(content);
    return { success: true };
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
