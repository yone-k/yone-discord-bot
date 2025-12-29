export interface OperationLogMetadata {
  messageId?: string;
  listTitle?: string;
  defaultCategory?: string;
  operationLogThreadId?: string | null;
}

export interface MetadataProviderResult {
  success: boolean;
  metadata?: OperationLogMetadata;
  message?: string;
}

export interface MetadataProvider {
  getChannelMetadata(channelId: string): Promise<MetadataProviderResult>;
}
