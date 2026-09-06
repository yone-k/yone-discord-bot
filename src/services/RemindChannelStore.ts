import type { RemindChannelMetadata } from '../models/RemindChannelMetadata';
import type { RemindChannel, RemindChannelRepository } from '../api/contracts';
import { ApiRemindChannelRepository } from '../api/Repositories';
import type { MetadataProvider, MetadataProviderResult } from './MetadataProvider';
export type { RemindChannelMetadata } from '../models/RemindChannelMetadata';
export interface RemindMetadataOperationResult extends MetadataProviderResult { metadata?: RemindChannelMetadata }
const toMetadata = (channel: RemindChannel): RemindChannelMetadata => ({
  channelId: channel.channelId, messageId: channel.messageId ?? '', listTitle: channel.listTitle,
  operationLogThreadId: channel.operationLogThreadId ?? undefined,
  remindNoticeThreadId: channel.remindNoticeThreadId ?? undefined,
  remindNoticeMessageId: channel.remindNoticeMessageId ?? undefined,
  linkedInventoryChannelId: channel.linkedInventoryChannelId ?? undefined
});

export class RemindChannelStore implements MetadataProvider {
  private static instance: RemindChannelStore | undefined;
  constructor(private readonly repository: RemindChannelRepository = new ApiRemindChannelRepository()) {}
  static getInstance(): RemindChannelStore { return this.instance ??= new RemindChannelStore(); }
  async getChannelMetadata(channelId: string): Promise<RemindMetadataOperationResult> {
    const channel = await this.repository.get(channelId);
    return channel ? { success: true, metadata: toMetadata(channel) } : { success: false, message: 'チャンネル設定が見つかりません' };
  }
  async listChannelMetadata(): Promise<RemindChannelMetadata[]> { return (await this.repository.list()).map(toMetadata); }
  async findChannelsLinkedToInventory(id: string): Promise<string[]> { return (await this.repository.linkedTo(id)).map(channel => channel.channelId); }
  async createChannelMetadata(channelId: string, messageId: string, listTitle: string, operationLogThreadId?: string,
    remindNoticeThreadId?: string, remindNoticeMessageId?: string, linkedInventoryChannelId?: string): Promise<RemindMetadataOperationResult> {
    await this.repository.save({ channelId, messageId: messageId || null, listTitle, operationLogThreadId: operationLogThreadId || null,
      remindNoticeThreadId: remindNoticeThreadId || null, remindNoticeMessageId: remindNoticeMessageId || null,
      linkedInventoryChannelId: linkedInventoryChannelId || null });
    return this.getChannelMetadata(channelId);
  }
  async updateChannelMetadata(channelId: string, updates: Partial<Omit<RemindChannelMetadata, 'channelId'>>): Promise<RemindMetadataOperationResult> {
    const patch: Partial<Omit<RemindChannel, 'channelId'>> = {};
    if (updates.listTitle !== undefined) patch.listTitle = updates.listTitle;
    for (const key of ['messageId', 'operationLogThreadId', 'remindNoticeThreadId', 'remindNoticeMessageId'] as const) {
      if (key in updates) patch[key] = updates[key] || null;
    }
    if ('linkedInventoryChannelId' in updates) await this.repository.linkInventory(channelId, updates.linkedInventoryChannelId || null);
    if (Object.keys(patch).length) await this.repository.patch(channelId, patch);
    return this.getChannelMetadata(channelId);
  }
}
