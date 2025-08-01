import { Logger } from '../utils/logger';
import { PermissionFlagsBits, Collection, Message, TextChannel, GuildMember } from 'discord.js';

export interface DeleteResult {
  deletedCount: number;
  message: string;
}

export class DeleteAllMessageLogic {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async checkPermissions(member: GuildMember): Promise<void> {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      throw new Error('メッセージを削除する権限がありません。');
    }
  }

  async deleteAllMessages(channel: TextChannel, userId: string): Promise<DeleteResult> {
    this.logger.info('Starting message deletion process', {
      channelId: channel.id,
      userId
    });

    try {
      // チャンネル内のすべてのメッセージを取得
      const messages = await this.fetchAllMessages(channel);

      if (messages.size === 0) {
        return {
          deletedCount: 0,
          message: this.getResultMessage(0)
        };
      }

      // メッセージを削除
      const deletedCount = await this.deleteMessages(channel, messages);

      this.logger.info('Message deletion completed', {
        channelId: channel.id,
        deletedCount,
        userId
      });

      return {
        deletedCount,
        message: this.getResultMessage(deletedCount)
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to delete messages', {
        channelId: channel.id,
        userId,
        error: errorMessage
      });
      throw new Error(`Failed to fetch messages: ${errorMessage}`);
    }
  }

  getResultMessage(count: number): string {
    if (count === 0) {
      return '削除対象のメッセージはありませんでした。';
    }
    return `${count}件のメッセージを削除しました。`;
  }

  private async fetchAllMessages(channel: TextChannel): Promise<Collection<string, Message>> {
    const messages = new Collection<string, Message>();
    let lastMessageId: string | undefined;
    let iterationCount = 0;
    const maxIterations = 1000; // 安全のための上限

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (iterationCount >= maxIterations) {
        this.logger.warn('Reached maximum iterations while fetching messages', {
          channelId: channel.id,
          iterationCount,
          messageCount: messages.size
        });
        break;
      }

      const fetchedMessages = await channel.messages.fetch({
        limit: 100,
        before: lastMessageId
      });

      if (fetchedMessages.size === 0) {
        break;
      }

      const previousSize = messages.size;
      for (const [id, message] of fetchedMessages) {
        messages.set(id, message);
      }

      // 新しいメッセージが追加されなかった場合は無限ループを防ぐために終了
      if (messages.size === previousSize) {
        this.logger.warn('No new messages added, breaking fetch loop', {
          channelId: channel.id,
          messageCount: messages.size
        });
        break;
      }

      const newLastMessageId = fetchedMessages.last()?.id;
      
      // lastMessageIdが変わらない場合は無限ループを防ぐために終了
      if (newLastMessageId === lastMessageId) {
        this.logger.warn('LastMessageId did not change, breaking fetch loop', {
          channelId: channel.id,
          lastMessageId,
          messageCount: messages.size
        });
        break;
      }

      lastMessageId = newLastMessageId;
      iterationCount++;
    }

    this.logger.debug('Finished fetching messages', {
      channelId: channel.id,
      totalMessages: messages.size,
      iterations: iterationCount
    });

    return messages;
  }

  private async deleteMessages(channel: TextChannel, messages: Collection<string, Message>): Promise<number> {
    const now = Date.now();
    const fourteenDaysAgo = now - (14 * 24 * 60 * 60 * 1000);

    // 14日以内のメッセージと14日を超えるメッセージを分離
    const recentMessages = new Collection<string, Message>();
    const oldMessages: Message[] = [];

    for (const [id, message] of messages) {
      if (message.createdTimestamp > fourteenDaysAgo) {
        recentMessages.set(id, message);
      } else {
        oldMessages.push(message);
      }
    }

    let deletedCount = 0;

    // 14日以内のメッセージはbulkDeleteで削除
    if (recentMessages.size > 0) {
      try {
        const bulkDeleted = await channel.bulkDelete(recentMessages);
        deletedCount += bulkDeleted.size;
        this.logger.debug('Bulk deleted recent messages', {
          count: bulkDeleted.size,
          channelId: channel.id
        });
      } catch (error) {
        this.logger.warn('Bulk delete failed, falling back to individual deletion', {
          error: error instanceof Error ? error.message : 'Unknown error',
          channelId: channel.id,
          messageCount: recentMessages.size
        });
        
        // bulkDeleteが失敗した場合は個別削除にフォールバック
        for (const message of recentMessages.values()) {
          try {
            await message.delete();
            deletedCount++;
          } catch (deleteError) {
            this.logger.warn('Failed to delete individual recent message', {
              messageId: message.id,
              error: deleteError instanceof Error ? deleteError.message : 'Unknown error'
            });
          }
        }
      }
    }

    // 14日を超えるメッセージは個別削除
    for (const message of oldMessages) {
      try {
        await message.delete();
        deletedCount++;
        this.logger.debug('Deleted old message', {
          messageId: message.id,
          channelId: channel.id
        });
      } catch (error) {
        this.logger.warn('Failed to delete old message', {
          messageId: message.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return deletedCount;
  }
}