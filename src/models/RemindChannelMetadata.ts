export interface RemindChannelMetadata {
  channelId: string;
  messageId: string;
  listTitle: string;
  lastSyncTime: Date;
  operationLogThreadId?: string;
  remindNoticeThreadId?: string;
  remindNoticeMessageId?: string;
  linkedInventoryChannelId?: string;
}
