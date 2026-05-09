export interface InventoryChannelMetadata {
  channelId: string;
  messageId: string;
  listTitle: string;
  lastSyncTime: Date;
  defaultCategory: string;
  operationLogThreadId?: string;
}
