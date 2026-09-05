export interface RemindChannelMetadata {
  channelId: string;
  messageId: string;
  listTitle: string;
  operationLogThreadId?: string;
  remindNoticeThreadId?: string;
  remindNoticeMessageId?: string;
  linkedInventoryChannelId?: string;
}
