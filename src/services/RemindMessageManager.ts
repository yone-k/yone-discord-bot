import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, TextChannel } from 'discord.js';
import { OperationResult } from './GoogleSheetsService';

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
    embed: EmbedBuilder,
    client: Client
  ): Promise<RemindMessageResult> {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { success: false, message: 'Channel not found' };
    }

    const message = await (channel as TextChannel).send({
      embeds: [embed],
      components: [this.buildActionRow()]
    });

    return { success: true, messageId: message.id };
  }

  public async updateTaskMessage(
    channelId: string,
    messageId: string,
    embed: EmbedBuilder,
    client: Client
  ): Promise<OperationResult> {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { success: false, message: 'Channel not found' };
    }

    const message = await (channel as TextChannel).messages.fetch(messageId);
    await message.edit({
      embeds: [embed],
      components: [this.buildActionRow()]
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
      .addComponents(updateButton, completeButton, deleteButton);
  }
}
