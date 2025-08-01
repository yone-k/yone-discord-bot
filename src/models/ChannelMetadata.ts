import { DEFAULT_CATEGORY } from './CategoryType';

export interface ChannelMetadata {
  channelId: string;
  messageId: string;
  listTitle: string;
  lastSyncTime: Date;
  defaultCategory: string;
  operationLogThreadId?: string;
}

/**
 * ChannelMetadataオブジェクトを作成
 * @param channelId チャンネルID
 * @param messageId メッセージID
 * @param listTitle リストタイトル
 * @param operationLogThreadId 操作ログスレッドID（省略可能）
 * @param defaultCategory デフォルトカテゴリ（省略時はDEFAULT_CATEGORY）
 * @returns 作成されたChannelMetadata
 */
export function createChannelMetadata(
  channelId: string,
  messageId: string,
  listTitle: string,
  operationLogThreadId?: string,
  defaultCategory?: string
): ChannelMetadata {
  return {
    channelId,
    messageId,
    listTitle: listTitle.trim(),
    lastSyncTime: new Date(),
    defaultCategory: defaultCategory || DEFAULT_CATEGORY,
    operationLogThreadId
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

/**
 * チャンネル名からリストタイトルを動的生成
 * @param channelName チャンネル名
 * @param channelId フォールバック用のチャンネルID
 * @returns 生成されたリストタイトル
 */
export function generateListTitle(channelName: string | null, channelId: string): string {
  if (!channelName || channelName.trim() === '') {
    return channelId;
  }
  
  return `${channelName.trim()}リスト`;
}