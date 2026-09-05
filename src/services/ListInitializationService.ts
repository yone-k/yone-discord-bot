import { Logger } from '../utils/logger';
import { CommandExecutionContext } from '../base/BaseCommand';
import { MessageManager } from './MessageManager';
import { ListChannelStore } from './ListChannelStore';
import { ListRepository } from '../repositories/contracts';
import { ListFormatter } from '../ui/ListFormatter';
import { toDisplayListItem } from '../utils/ListInput';
import { CategoryType } from '../models/CategoryType';
import { TextChannel, Message } from 'discord.js';
export interface ListInitializationResult {
    success: boolean;
    message?: Message;
    operationLogThreadId?: string;
    errorMessage?: string;
    itemCount?: number;
}
export class ListInitializationService {
  private logger = new Logger();
  constructor(private repository: ListRepository, private messageManager: MessageManager, private metadataManager: ListChannelStore) { }
  async initializeList(context: CommandExecutionContext, enableLog: boolean | null, defaultCategory: CategoryType, redrawOnly = false): Promise<ListInitializationResult> {
    if (!context.channelId || !context.interaction)
      throw new Error('チャンネルIDまたはインタラクションがありません');
    const channelId = context.channelId;
    const existing = await this.metadataManager.getChannelMetadata(channelId);
    const channelName = context.interaction.channel && 'name' in context.interaction.channel ? context.interaction.channel.name : 'リスト';
    if (redrawOnly && !existing.metadata)
      throw new Error('リストが初期化されていません');
    const listTitle = redrawOnly ? existing.metadata!.listTitle : `${channelName}リスト`;
    let operationLogThreadId = existing.metadata?.operationLogThreadId || '';
    if (enableLog === true)
      operationLogThreadId = await this.createOperationLogThread(context) || '';
    if (enableLog === false)
      operationLogThreadId = '';
    const settings = { messageId: existing.metadata?.messageId || '', listTitle, defaultCategory, operationLogThreadId };
    if (!redrawOnly) {
      const saved = existing.metadata
        ? await this.metadataManager.updateChannelMetadata(channelId, settings)
        : await this.metadataManager.createChannelMetadata(channelId, settings);
      if (!saved.success)
        throw new Error(saved.message || 'リスト設定の保存に失敗しました');
    }
    const items = (await this.repository.fetchAll(channelId)).map(toDisplayListItem);
    const content = items.length ? await ListFormatter.formatDataListContent(listTitle, items, channelId, defaultCategory)
      : await ListFormatter.formatEmptyListContent(listTitle, channelId, undefined, defaultCategory);
    const components = ListFormatter.buildListComponents(content);
    const result = redrawOnly
      ? await this.messageManager.createOrUpdateMessageWithMetadataV2(channelId, components, listTitle, context.interaction.client, 'list')
      : await this.messageManager.createOrUpdateMessageWithMetadataV2(channelId, components, listTitle, context.interaction.client, 'list', defaultCategory, operationLogThreadId);
    if (!result.success)
      throw new Error(result.errorMessage || 'リスト表示に失敗しました');
    return { success: true, message: result.message, operationLogThreadId: operationLogThreadId || undefined, itemCount: items.length };
  }
  private async createOperationLogThread(context: CommandExecutionContext): Promise<string | null> {
    try {
      if (!context.interaction?.channel || !('threads' in context.interaction.channel)) {
        this.logger.debug('Channel does not support threads', {
          channelId: context.channelId
        });
        return null;
      }
      // 既存のスレッドIDをチェック
      if (!context.channelId) {
        this.logger.debug('Channel ID is not available', { context });
        return null;
      }
      const metadataResult = await this.metadataManager.getChannelMetadata(context.channelId);
      if (metadataResult.success && metadataResult.metadata?.operationLogThreadId) {
        const existingThreadId = metadataResult.metadata.operationLogThreadId;
        // 既存スレッドの有効性を確認
        try {
          const existingThread = await context.interaction!.client.channels.fetch(existingThreadId);
          if (existingThread && existingThread.isThread()) {
            this.logger.debug('Using existing operation log thread', {
              threadId: existingThreadId,
              channelId: context.channelId
            });
            return existingThreadId;
          }
          else {
            this.logger.debug('Existing thread is not valid, creating new one', {
              threadId: existingThreadId,
              channelId: context.channelId
            });
          }
        }
        catch (error) {
          this.logger.debug('Existing thread is not accessible, creating new one', {
            threadId: existingThreadId,
            channelId: context.channelId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      // 新しいスレッドを作成
      const channel = context.interaction.channel as TextChannel;
      const thread = await channel.threads.create({
        name: '操作ログ',
        autoArchiveDuration: 1440, // 24時間
        reason: 'リスト操作の記録用スレッド'
      });
      this.logger.debug('Operation log thread created successfully', {
        threadId: thread.id,
        channelId: context.channelId
      });
      return thread.id;
    }
    catch (error) {
      // 非侵襲的なエラーハンドリング - エラーを投げずにログに記録
      this.logger.debug('Failed to create operation log thread', {
        channelId: context.channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }
}
