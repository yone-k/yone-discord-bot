import type { InventoryChannelMetadata } from '../models/InventoryChannelMetadata';
import type { InventoryChannel, InventoryChannelRepository, OperationResult } from '../api/contracts';
import { ApiInventoryChannelRepository } from '../api/Repositories';
export type { InventoryChannelMetadata } from '../models/InventoryChannelMetadata';

const toMetadata = (channel: InventoryChannel): InventoryChannelMetadata => ({
  channelId: channel.channelId, messageId: channel.messageId ?? '', listTitle: channel.listTitle,
  defaultCategory: channel.defaultCategory, operationLogThreadId: channel.operationLogThreadId ?? undefined
});

export class InventoryChannelStore {
  private static instance: InventoryChannelStore | undefined;
  constructor(private readonly repository: InventoryChannelRepository = new ApiInventoryChannelRepository()) {}
  static getInstance(): InventoryChannelStore { return this.instance ??= new InventoryChannelStore(); }
  async getChannelMetadata(channelId: string): Promise<InventoryChannelMetadata | null> {
    const channel = await this.repository.get(channelId);
    return channel ? toMetadata(channel) : null;
  }
  async listChannelMetadata(): Promise<InventoryChannelMetadata[]> { return (await this.repository.list()).map(toMetadata); }
  async createChannelMetadata(channelId: string, metadata: Omit<InventoryChannelMetadata, 'channelId'>): Promise<OperationResult> {
    await this.repository.save({ channelId, messageId: metadata.messageId || null, listTitle: metadata.listTitle,
      defaultCategory: metadata.defaultCategory, operationLogThreadId: metadata.operationLogThreadId || null });
    return { success: true };
  }
  async updateChannelMetadata(channelId: string, updates: Partial<Omit<InventoryChannelMetadata, 'channelId'>>): Promise<OperationResult> {
    const patch: Partial<Omit<InventoryChannel, 'channelId'>> = {};
    if ('messageId' in updates) patch.messageId = updates.messageId || null;
    if (updates.listTitle !== undefined) patch.listTitle = updates.listTitle;
    if (updates.defaultCategory !== undefined) patch.defaultCategory = updates.defaultCategory;
    if ('operationLogThreadId' in updates) patch.operationLogThreadId = updates.operationLogThreadId || null;
    await this.repository.patch(channelId, patch);
    return { success: true };
  }
}
