import { Client, MessageFlags, TextChannel } from 'discord.js';
import type { APIMessageTopLevelComponent, Message } from 'discord.js';
import type { InventoryItem } from '../models/InventoryItem';
import { InventoryFormatter } from '../ui/InventoryFormatter';
import { InventoryChannelStore } from './InventoryChannelStore';
import type { InventoryChannelMetadata } from './InventoryChannelStore';
import type { MessageOperationResult } from './MessageManager';

export class InventoryMessageManager {
  private static instance: InventoryMessageManager | undefined;
  private metadataManager: InventoryChannelStore;

  private constructor() {
    this.metadataManager = InventoryChannelStore.getInstance();
  }

  public static getInstance(): InventoryMessageManager {
    if (!InventoryMessageManager.instance) {
      InventoryMessageManager.instance = new InventoryMessageManager();
    }
    return InventoryMessageManager.instance;
  }

  public async createOrUpdateMessage(
    channelId: string,
    items: InventoryItem[],
    listTitle: string,
    client: Client
  ): Promise<MessageOperationResult> {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return { success: false, errorMessage: 'Channel not found' };
      }

      const textChannel = channel as TextChannel;
      const metadata = await this.metadataManager.getChannelMetadata(channelId);
      const title = metadata?.listTitle ?? listTitle;
      const content = items.length === 0
        ? await InventoryFormatter.formatEmptyContent(title, channelId, metadata?.defaultCategory)
        : await InventoryFormatter.formatDataContent(items, title, channelId, metadata?.defaultCategory);
      const components = InventoryFormatter.buildInventoryComponents(content);
      let message: Message | undefined;

      if (metadata?.messageId) {
        message = await this.tryUpdateExistingMessage(
          textChannel,
          metadata.messageId,
          components
        );
      }

      if (!message) {
        message = await textChannel.send({
          flags: MessageFlags.IsComponentsV2,
          components
        });
      }

      await this.saveMetadata(channelId, message.id, listTitle, metadata);

      return { success: true, message };
    } catch (error) {
      return {
        success: false,
        errorMessage: `Failed to create or update inventory message: ${(error as Error).message}`
      };
    }
  }

  private async tryUpdateExistingMessage(
    channel: TextChannel,
    messageId: string,
    components: APIMessageTopLevelComponent[]
  ): Promise<Message | undefined> {
    try {
      const message = await channel.messages.fetch(messageId);
      return await message.edit({
        content: null,
        embeds: [],
        flags: MessageFlags.IsComponentsV2,
        components
      });
    } catch {
      return undefined;
    }
  }

  private async saveMetadata(
    channelId: string,
    messageId: string,
    listTitle: string,
    existingMetadata: InventoryChannelMetadata | null
  ): Promise<void> {
    if (existingMetadata) {
      await this.metadataManager.updateChannelMetadata(channelId, { messageId });
      return;
    }

    const metadata = {
      messageId,
      listTitle,
      defaultCategory: 'その他'
    };
    await this.metadataManager.createChannelMetadata(channelId, metadata);
  }
}
