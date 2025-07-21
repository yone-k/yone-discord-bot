import { EmbedBuilder, TextChannel, Message, ChannelType, Client } from 'discord.js';
import { MetadataManager, MetadataOperationResult } from './MetadataManager';
import { ChannelMetadata } from '../models/ChannelMetadata';

export enum MessageManagerErrorType {
  CHANNEL_NOT_FOUND = 'CHANNEL_NOT_FOUND',
  MESSAGE_NOT_FOUND = 'MESSAGE_NOT_FOUND',
  UPDATE_FAILED = 'UPDATE_FAILED',
  CREATE_FAILED = 'CREATE_FAILED',
  INVALID_CHANNEL_TYPE = 'INVALID_CHANNEL_TYPE',
  METADATA_ERROR = 'METADATA_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED'
}

export class MessageManagerError extends Error {
  public readonly type: MessageManagerErrorType;
  public readonly userMessage: string;
  public readonly originalError?: Error;

  constructor(
    type: MessageManagerErrorType,
    message: string,
    userMessage?: string,
    originalError?: Error
  ) {
    super(message);
    this.name = 'MessageManagerError';
    this.type = type;
    this.userMessage = userMessage || this.getDefaultUserMessage(type);
    this.originalError = originalError;
  }

  private getDefaultUserMessage(type: MessageManagerErrorType): string {
    switch (type) {
    case MessageManagerErrorType.CHANNEL_NOT_FOUND:
      return 'チャンネルが見つかりません。';
    case MessageManagerErrorType.MESSAGE_NOT_FOUND:
      return 'メッセージが見つかりません。';
    case MessageManagerErrorType.UPDATE_FAILED:
      return 'メッセージの更新に失敗しました。';
    case MessageManagerErrorType.CREATE_FAILED:
      return 'メッセージの作成に失敗しました。';
    case MessageManagerErrorType.INVALID_CHANNEL_TYPE:
      return 'テキストチャンネルではありません。';
    case MessageManagerErrorType.METADATA_ERROR:
      return 'メタデータの操作に失敗しました。';
    case MessageManagerErrorType.PERMISSION_DENIED:
      return 'メッセージ操作の権限がありません。';
    default:
      return '予期しないエラーが発生しました。';
    }
  }
}

export interface MessageOperationResult {
  success: boolean;
  message?: Message;
  errorMessage?: string;
}

export class MessageManager {
  private metadataManager: MetadataManager;
  // チャンネル単位での並行処理制御用のロックMap
  private readonly channelLocks = new Map<string, Promise<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  private readonly lockTimeout = 30000; // 30秒のタイムアウト

  constructor() {
    this.metadataManager = new MetadataManager();
  }

  /**
   * チャンネル単位のロック機能
   */
  private async withChannelLock<T>(
    channelId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const lockKey = `channel:${channelId}`;
    
    // 既存のロックがある場合は待機
    if (this.channelLocks.has(lockKey)) {
      try {
        await this.channelLocks.get(lockKey);
      } catch {
        // エラーは無視して続行
      }
    }
    
    // 新しい操作を実行
    const operationPromise = operation();
    this.channelLocks.set(lockKey, operationPromise);
    
    try {
      const result = await Promise.race([
        operationPromise,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), this.lockTimeout)
        )
      ]);
      
      return result;
    } finally {
      // ロックを削除
      this.channelLocks.delete(lockKey);
    }
  }

  /**
   * メッセージを作成または更新する（非推奨 - createOrUpdateMessageWithMetadataを使用）
   * 既存メッセージがある場合は更新、ない場合は新規作成
   */
  public async createOrUpdateMessage(
    channelId: string,
    embed: EmbedBuilder,
    client: Client
  ): Promise<MessageOperationResult> {
    // この関数は後方互換性のために残しているが、実際にはメタデータチェックなしで動作
    try {
      // 新規メッセージ作成のみ実行（メタデータチェックは別途実施）
      return await this.createMessage(channelId, embed, client);
    } catch (error) {
      return {
        success: false,
        errorMessage: `Failed to create or update message: ${(error as Error).message}`
      };
    }
  }

  /**
   * 指定されたチャンネルとメッセージIDからメッセージを取得
   */
  public async getMessage(
    channelId: string,
    messageId: string,
    client: Client
  ): Promise<MessageOperationResult> {
    try {
      // チャンネルを取得
      const channel = await client.channels.fetch(channelId);
      
      if (!channel) {
        throw new MessageManagerError(
          MessageManagerErrorType.CHANNEL_NOT_FOUND,
          `Channel not found: ${channelId}`
        );
      }
      
      if (channel.type !== ChannelType.GuildText) {
        throw new MessageManagerError(
          MessageManagerErrorType.INVALID_CHANNEL_TYPE,
          `Channel is not a text channel: ${channelId}`
        );
      }
      
      const textChannel = channel as TextChannel;
      
      // メッセージを取得
      const message = await textChannel.messages.fetch(messageId);
      
      if (!message) {
        throw new MessageManagerError(
          MessageManagerErrorType.MESSAGE_NOT_FOUND,
          `Message not found: ${messageId}`
        );
      }
      
      return {
        success: true,
        message
      };
      
    } catch (error) {
      if (error instanceof MessageManagerError) {
        return {
          success: false,
          errorMessage: error.userMessage
        };
      }
      
      return {
        success: false,
        errorMessage: `Failed to get message: ${(error as Error).message}`
      };
    }
  }

  /**
   * 既存メッセージを更新
   */
  public async updateMessage(
    channelId: string,
    messageId: string,
    embed: EmbedBuilder,
    client: Client
  ): Promise<MessageOperationResult> {
    try {
      // メッセージを取得
      const getResult = await this.getMessage(channelId, messageId, client);
      
      if (!getResult.success || !getResult.message) {
        throw new MessageManagerError(
          MessageManagerErrorType.MESSAGE_NOT_FOUND,
          `Failed to get message for update: ${getResult.errorMessage}`
        );
      }
      
      // メッセージを更新
      const updatedMessage = await getResult.message.edit({ embeds: [embed] });
      
      return {
        success: true,
        message: updatedMessage
      };
      
    } catch (error) {
      if (error instanceof MessageManagerError) {
        return {
          success: false,
          errorMessage: error.userMessage
        };
      }
      
      return {
        success: false,
        errorMessage: `Failed to update message: ${(error as Error).message}`
      };
    }
  }

  /**
   * 新規メッセージを作成
   */
  public async createMessage(
    channelId: string,
    embed: EmbedBuilder,
    client: Client
  ): Promise<MessageOperationResult> {
    try {
      // チャンネルを取得
      const channel = await client.channels.fetch(channelId);
      
      if (!channel) {
        throw new MessageManagerError(
          MessageManagerErrorType.CHANNEL_NOT_FOUND,
          `Channel not found: ${channelId}`
        );
      }
      
      if (channel.type !== ChannelType.GuildText) {
        throw new MessageManagerError(
          MessageManagerErrorType.INVALID_CHANNEL_TYPE,
          `Channel is not a text channel: ${channelId}`
        );
      }
      
      const textChannel = channel as TextChannel;
      
      // メッセージを送信
      const message = await textChannel.send({ embeds: [embed] });
      
      return {
        success: true,
        message
      };
      
    } catch (error) {
      if (error instanceof MessageManagerError) {
        return {
          success: false,
          errorMessage: error.userMessage
        };
      }
      
      return {
        success: false,
        errorMessage: `Failed to create message: ${(error as Error).message}`
      };
    }
  }

  /**
   * メタデータマネージャーを使用してメッセージIDを更新（内部使用のみ、既存メタデータ付き）
   */
  private async updateMessageMetadataInternal(
    channelId: string,
    messageId: string,
    listTitle: string,
    existingMetadata?: ChannelMetadata
  ): Promise<MetadataOperationResult> {
    try {
      if (existingMetadata) {
        // メタデータが存在する場合は更新
        const updatedMetadata: ChannelMetadata = {
          ...existingMetadata,
          messageId,
          listTitle,
          lastSyncTime: new Date()
        };
        
        return await this.metadataManager.updateChannelMetadata(channelId, updatedMetadata);
      } else {
        // メタデータが存在しない場合は新規作成
        const newMetadata: ChannelMetadata = {
          channelId,
          messageId,
          listTitle,
          lastSyncTime: new Date()
        };
        
        return await this.metadataManager.createChannelMetadata(channelId, newMetadata);
      }
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to update message metadata: ${(error as Error).message}`
      };
    }
  }

  /**
   * メッセージとメタデータを同時に作成または更新（原子的操作）
   */
  public async createOrUpdateMessageWithMetadata(
    channelId: string,
    embed: EmbedBuilder,
    listTitle: string,
    client: Client
  ): Promise<MessageOperationResult> {
    return this.withChannelLock(channelId, async () => {
      try {
        // ステップ1: メタデータを一度だけ取得（単一チェックポイント）
        const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
        
        let messageResult: MessageOperationResult;
        
        // ステップ2: メタデータの存在によって処理を分岐
        if (metadataResult.success && metadataResult.metadata?.messageId) {
          // 既存メッセージの更新を試行
          messageResult = await this.updateMessage(
            channelId,
            metadataResult.metadata.messageId,
            embed,
            client
          );
          
          // 更新に失敗した場合は新規作成にフォールバック
          if (!messageResult.success) {
            console.warn(`Failed to update message ${metadataResult.metadata.messageId}, creating new message`);
            messageResult = await this.createMessage(channelId, embed, client);
          }
        } else {
          // 新規メッセージ作成
          messageResult = await this.createMessage(channelId, embed, client);
        }
        
        // ステップ3: メッセージ作成が成功した場合のみメタデータを更新
        if (!messageResult.success || !messageResult.message) {
          return messageResult;
        }
        
        // ステップ4: メタデータ更新（既存メタデータを渡して重複取得を防ぐ）
        const metadataUpdateResult = await this.updateMessageMetadataInternal(
          channelId,
          messageResult.message.id,
          listTitle,
          metadataResult.success ? metadataResult.metadata : undefined
        );
        
        if (!metadataUpdateResult.success) {
          console.warn(`Failed to update metadata: ${metadataUpdateResult.message}`);
          // メッセージ作成は成功しているので、警告のみ出力して処理は継続
        }
        
        return messageResult;
        
      } catch (error) {
        return {
          success: false,
          errorMessage: `Failed to create or update message with metadata: ${(error as Error).message}`
        };
      }
    });
  }

  /**
   * メタデータマネージャーを使用してメッセージIDを更新（後方互換性用）
   * @deprecated 新しいコードではcreateOrUpdateMessageWithMetadataを使用してください
   */
  public async updateMessageMetadata(
    channelId: string,
    messageId: string,
    listTitle: string
  ): Promise<MetadataOperationResult> {
    // 既存メタデータを取得して内部関数に委譲
    const existingResult = await this.metadataManager.getChannelMetadata(channelId);
    return this.updateMessageMetadataInternal(
      channelId,
      messageId,
      listTitle,
      existingResult.success ? existingResult.metadata : undefined
    );
  }
}