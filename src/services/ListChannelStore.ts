import type { ChannelMetadata } from '../models/ChannelMetadata';
import type { ListChannel, ListChannelRepository } from '../repositories/contracts';
import { PostgresListChannelRepository } from '../repositories/PostgresListChannelRepository';
import type { MetadataProvider } from './MetadataProvider';

export interface MetadataOperationResult { success: boolean; metadata?: ChannelMetadata; message?: string }
const toMetadata = (channel: ListChannel): ChannelMetadata => ({
  channelId: channel.channelId, messageId: channel.messageId ?? '', listTitle: channel.listTitle,
  defaultCategory: channel.defaultCategory, operationLogThreadId: channel.operationLogThreadId ?? undefined
});

export class ListChannelStore implements MetadataProvider {
  private static instance: ListChannelStore | undefined;
  constructor(private readonly repository: ListChannelRepository = new PostgresListChannelRepository()) {}
  static getInstance(): ListChannelStore { return this.instance ??= new ListChannelStore(); }
  async getChannelMetadata(channelId: string): Promise<MetadataOperationResult> {
    const channel = await this.repository.get(channelId);
    return channel ? { success: true, metadata: toMetadata(channel) } : { success: false, message: 'チャンネル設定が見つかりません' };
  }
  async listChannelMetadata(): Promise<ChannelMetadata[]> { return (await this.repository.list()).map(toMetadata); }
  async createChannelMetadata(channelId: string, metadata: Omit<ChannelMetadata, 'channelId'>): Promise<MetadataOperationResult> {
    await this.repository.save({ channelId, messageId: metadata.messageId || null, listTitle: metadata.listTitle,
      defaultCategory: metadata.defaultCategory, operationLogThreadId: metadata.operationLogThreadId || null });
    return this.getChannelMetadata(channelId);
  }
  async updateChannelMetadata(channelId: string, updates: Partial<Omit<ChannelMetadata, 'channelId'>>): Promise<MetadataOperationResult> {
    const patch: Partial<Omit<ListChannel, 'channelId' | 'editVersion'>> = {};
    if ('messageId' in updates) patch.messageId = updates.messageId || null;
    if (updates.listTitle !== undefined) patch.listTitle = updates.listTitle;
    if (updates.defaultCategory !== undefined) patch.defaultCategory = updates.defaultCategory;
    if ('operationLogThreadId' in updates) patch.operationLogThreadId = updates.operationLogThreadId || null;
    await this.repository.patch(channelId, patch);
    return this.getChannelMetadata(channelId);
  }
}
