import { CommandExecutionContext } from '../base/BaseCommand';
import { ListChannelStore } from './ListChannelStore';
import { ListRepository } from '../api/contracts';
import { CategoryType } from '../models/CategoryType';
import { OutputApi } from '../api/OutputApi';

export interface ListInitializationResult {
  success: true;
  itemCount: number;
}
export class ListInitializationService {
  constructor(private repository: ListRepository, private outputs: Pick<OutputApi, 'initialize' | 'redraw'>, private metadataManager: ListChannelStore) {}
  async initializeList(context: CommandExecutionContext, enableLog: boolean | null, defaultCategory: CategoryType, redrawOnly = false): Promise<ListInitializationResult> {
    if (!context.channelId || !context.interaction)
      throw new Error('チャンネルIDまたはインタラクションがありません');
    const channelId = context.channelId;
    const existing = await this.metadataManager.getChannelMetadata(channelId);
    if (redrawOnly && !existing.metadata)
      throw new Error('リストが初期化されていません');
    if (!redrawOnly) {
      const channelName = context.interaction.channel && 'name' in context.interaction.channel ? context.interaction.channel.name : 'リスト';
      const settings = { listTitle: `${channelName}リスト`, defaultCategory };
      const saved = existing.metadata
        ? await this.metadataManager.updateChannelMetadata(channelId, settings)
        : await this.metadataManager.createChannelMetadata(channelId, settings);
      if (!saved.success)
        throw new Error(saved.message || 'リスト設定の保存に失敗しました');
    }
    if (redrawOnly) {
      await this.outputs.redraw(channelId, 'list');
    } else {
      await this.outputs.initialize(channelId, { kind: 'list', ...(enableLog === null ? {} : { enableLog }) });
    }
    const items = await this.repository.fetchAll(channelId);
    return { success: true, itemCount: items.length };
  }
}
