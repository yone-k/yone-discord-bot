import type { Client } from 'discord.js';
import type { InventoryChannelStore } from './InventoryChannelStore';
import type { InventoryMessageManager } from './InventoryMessageManager';
import { InventoryRepository } from './InventoryRepository';

export interface InitializationContext {
  channelId: string;
  listTitle: string;
  client: Client;
}

export interface InventoryInitializationResult {
  success: boolean;
  message?: string;
}

export class InventoryInitializationService {
  constructor(
    private metadataManager: InventoryChannelStore,
    private messageManager: InventoryMessageManager,
    private repository: Pick<InventoryRepository, 'fetchAll'> = new InventoryRepository()
  ) {}

  public async initializeInventory(
    context: InitializationContext
  ): Promise<InventoryInitializationResult> {
    const current = await this.metadataManager.getChannelMetadata(context.channelId);
    if (!current) await this.metadataManager.createChannelMetadata(context.channelId, { messageId: '', listTitle: context.listTitle, defaultCategory: '' });
    const items = await this.repository.fetchAll(context.channelId);

    const messageResult = await this.messageManager.createOrUpdateMessage(
      context.channelId,
      items,
      context.listTitle,
      context.client
    );
    if (!messageResult.success) {
      return { success: false, message: messageResult.errorMessage };
    }

    return { success: true };
  }
}
