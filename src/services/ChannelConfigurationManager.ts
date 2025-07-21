import { ChannelMetadata, validateChannelMetadata } from '../models/ChannelMetadata';

export interface DiscordChannel {
  id: string;
  send(content: string): Promise<DiscordMessage>;
  messages: {
    fetch(messageId: string): Promise<DiscordMessage>;
  };
}

export interface DiscordMessage {
  id: string;
  pin(): Promise<void>;
  unpin(): Promise<void>;
  edit(content: string): Promise<DiscordMessage>;
  delete(): Promise<void>;
}

export class ChannelConfigurationError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(message);
    this.name = 'ChannelConfigurationError';
  }
}

export class ChannelConfigurationManager {
  private configurations: Map<string, ChannelMetadata> = new Map();

  public async saveConfiguration(metadata: ChannelMetadata): Promise<void> {
    try {
      validateChannelMetadata(metadata);
      this.configurations.set(metadata.channelId, { ...metadata });
    } catch (error) {
      throw new ChannelConfigurationError(
        `設定の保存に失敗しました: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  public async getConfiguration(channelId: string): Promise<ChannelMetadata> {
    const config = this.configurations.get(channelId);
    if (!config) {
      throw new ChannelConfigurationError('チャンネル設定が見つかりません');
    }
    return { ...config };
  }

  public async updateConfiguration(metadata: ChannelMetadata): Promise<void> {
    try {
      validateChannelMetadata(metadata);
      
      // 既存の設定が存在するかチェック
      const existingConfig = this.configurations.get(metadata.channelId);
      if (!existingConfig) {
        throw new ChannelConfigurationError('更新対象のチャンネル設定が見つかりません');
      }
      
      this.configurations.set(metadata.channelId, { ...metadata });
    } catch (error) {
      if (error instanceof ChannelConfigurationError) {
        throw error;
      }
      throw new ChannelConfigurationError(
        `設定の更新に失敗しました: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  public async deleteConfiguration(channelId: string): Promise<void> {
    const deleted = this.configurations.delete(channelId);
    if (!deleted) {
      throw new ChannelConfigurationError('削除対象のチャンネル設定が見つかりません');
    }
  }

  public async getMessageId(channelId: string): Promise<string> {
    const config = await this.getConfiguration(channelId);
    return config.messageId;
  }

  public async updateMessageId(channelId: string, messageId: string): Promise<void> {
    const config = await this.getConfiguration(channelId);
    const updatedConfig = {
      ...config,
      messageId,
      lastSyncTime: new Date()
    };
    await this.updateConfiguration(updatedConfig);
  }

  public async updateSyncTime(channelId: string): Promise<void> {
    const config = await this.getConfiguration(channelId);
    const updatedConfig = {
      ...config,
      lastSyncTime: new Date()
    };
    await this.updateConfiguration(updatedConfig);
  }

  public async getAllConfigurations(): Promise<ChannelMetadata[]> {
    return Array.from(this.configurations.values()).map(config => ({ ...config }));
  }

  public async createPinnedMessage(
    channel: DiscordChannel,
    content: string
  ): Promise<string> {
    try {
      const message = await channel.send(content);
      await message.pin();
      return message.id;
    } catch (error) {
      throw new ChannelConfigurationError(
        `固定メッセージの作成に失敗しました: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  public async updatePinnedMessage(
    channel: DiscordChannel,
    messageId: string,
    content: string
  ): Promise<void> {
    try {
      const message = await channel.messages.fetch(messageId);
      await message.edit(content);
    } catch (error) {
      if ((error as Error).message.includes('Unknown Message')) {
        throw new ChannelConfigurationError('メッセージが見つかりません');
      }
      throw new ChannelConfigurationError(
        `固定メッセージの更新に失敗しました: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  public async deletePinnedMessage(
    channel: DiscordChannel,
    messageId: string
  ): Promise<void> {
    try {
      const message = await channel.messages.fetch(messageId);
      await message.unpin();
      await message.delete();
    } catch (error) {
      if ((error as Error).message.includes('Unknown Message')) {
        throw new ChannelConfigurationError('メッセージが見つかりません');
      }
      throw new ChannelConfigurationError(
        `固定メッセージの削除に失敗しました: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  public hasConfiguration(channelId: string): boolean {
    return this.configurations.has(channelId);
  }

  public getConfigurationCount(): number {
    return this.configurations.size;
  }

  public async clearAllConfigurations(): Promise<void> {
    this.configurations.clear();
  }
}