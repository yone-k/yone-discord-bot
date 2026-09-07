import type { ChannelMetadata } from '../models/ChannelMetadata';
import type { ListChannel, Schema, ListChannelRepository } from '../api/contracts';
import { ApiListChannelRepository } from '../api/Repositories';
import type { MetadataProvider } from './MetadataProvider';

export interface MetadataOperationResult { success: boolean; metadata?: ChannelMetadata; message?: string }
const toMetadata = (channel: ListChannel): ChannelMetadata => ({
  channelId: channel.channelId, messageId: channel.messageId ?? '', listTitle: channel.listTitle,
  defaultCategory: channel.defaultCategory, operationLogThreadId: channel.operationLogThreadId ?? undefined
});

export class ListChannelStore implements MetadataProvider {
  private static instance: ListChannelStore | undefined;
  constructor(private readonly repository: ListChannelRepository = new ApiListChannelRepository()) {}
  static getInstance(): ListChannelStore { return this.instance ??= new ListChannelStore(); }
  async getChannelMetadata(channelId: string): Promise<MetadataOperationResult> {
    const channel = await this.repository.get(channelId);
    return channel ? { success: true, metadata: toMetadata(channel) } : { success: false, message: 'チャンネル設定が見つかりません' };
  }
  async listChannelMetadata(): Promise<ChannelMetadata[]> { return (await this.repository.list()).map(toMetadata); }
  async createChannelMetadata(channelId: string, metadata: Pick<ChannelMetadata, 'listTitle' | 'defaultCategory'>): Promise<MetadataOperationResult> {
    await this.repository.save({ channelId, listTitle: metadata.listTitle,
      defaultCategory: metadata.defaultCategory });
    return this.getChannelMetadata(channelId);
  }
  async updateChannelMetadata(channelId: string, updates: Partial<Pick<ChannelMetadata, 'listTitle' | 'defaultCategory'>>): Promise<MetadataOperationResult> {
    const patch: Schema['ListChannelPatch'] = {};
    if (updates.listTitle !== undefined) patch.listTitle = updates.listTitle;
    if (updates.defaultCategory !== undefined) patch.defaultCategory = updates.defaultCategory;
    await this.repository.patch(channelId, patch);
    return this.getChannelMetadata(channelId);
  }
}
