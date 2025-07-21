export interface ChannelMetadata {
  channelId: string;
  messageId: string;
  listTitle: string;
  listType: 'shopping' | 'todo' | 'other';
  lastSyncTime: Date;
}

export function createChannelMetadata(
  channelId: string,
  messageId: string,
  listTitle: string,
  listType: 'shopping' | 'todo' | 'other'
): ChannelMetadata {
  return {
    channelId,
    messageId,
    listTitle: listTitle.trim(),
    listType,
    lastSyncTime: new Date()
  };
}

export function validateChannelMetadata(metadata: ChannelMetadata): void {
  if (!metadata.channelId) {
    throw new Error('チャンネルIDは必須です');
  }
  
  if (!metadata.messageId) {
    throw new Error('メッセージIDは必須です');
  }
  
  if (!metadata.listTitle || metadata.listTitle.trim() === '') {
    throw new Error('リストタイトルは必須です');
  }
  
  const validListTypes = ['shopping', 'todo', 'other'];
  if (!validListTypes.includes(metadata.listType)) {
    throw new Error('無効なリストタイプです');
  }
  
  if (!(metadata.lastSyncTime instanceof Date) || isNaN(metadata.lastSyncTime.getTime())) {
    throw new Error('同期時間が無効です');
  }
}

export function updateSyncTime(metadata: ChannelMetadata): ChannelMetadata {
  return {
    ...metadata,
    lastSyncTime: new Date()
  };
}