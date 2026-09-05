import { Client } from 'discord.js';
import { ListRepository } from '../repositories/contracts';
import { MessageManager } from '../services/MessageManager';
import { MetadataProvider } from '../services/MetadataProvider';
import { ListFormatter } from '../ui/ListFormatter';
import { toDisplayListItem } from './ListInput';
export async function redrawList(channelId: string, client: Client, repository: ListRepository, messageManager: MessageManager, metadata: MetadataProvider): Promise<void> {
  const result = await metadata.getChannelMetadata(channelId);
  if (!result.success || !result.metadata)
    throw new Error('リストが初期化されていません');
  const settings = result.metadata;
  const title = settings.listTitle || 'リスト';
  const items = (await repository.fetchAll(channelId)).map(toDisplayListItem);
  const content = items.length ? await ListFormatter.formatDataListContent(title, items, channelId, settings.defaultCategory)
    : await ListFormatter.formatEmptyListContent(title, channelId, undefined, settings.defaultCategory);
  const message = await messageManager.createOrUpdateMessageWithMetadataV2(channelId, ListFormatter.buildListComponents(content), title, client, 'list');
  if (!message.success)
    throw new Error(message.errorMessage || '表示更新に失敗しました');
}
