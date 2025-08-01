import { Logger } from '../utils/logger';
import { MetadataManager } from './MetadataManager';
import { OperationInfo, OperationResult, OperationDetails } from '../models/types/OperationLog';
import { Client, ChannelType, TextChannel, ThreadChannel } from 'discord.js';

/**
 * 操作ログサービス
 * ボタン操作時の誰が何をしてどうなったかをスレッドに記録するサービス
 */
export class OperationLogService {
  private logger: Logger;
  private metadataManager: MetadataManager;

  constructor(logger: Logger, metadataManager: MetadataManager) {
    this.logger = logger;
    this.metadataManager = metadataManager;
  }

  /**
   * ログメッセージをフォーマットする
   * @param operationInfo 操作情報
   * @param result 操作結果
   * @param userId ユーザーID
   * @param timestamp タイムスタンプ（デフォルト: 現在時刻）
   * @param details 操作詳細（オプション）
   * @returns フォーマットされたログメッセージ
   */
  public formatLogMessage(
    operationInfo: OperationInfo,
    result: OperationResult,
    userId: string,
    timestamp: Date = new Date(),
    details?: OperationDetails
  ): string {
    // 日時を「YYYY/MM/DD HH:mm:ss」形式でフォーマット（UTC）
    const year = timestamp.getUTCFullYear();
    const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
    const day = String(timestamp.getUTCDate()).padStart(2, '0');
    const hours = String(timestamp.getUTCHours()).padStart(2, '0');
    const minutes = String(timestamp.getUTCMinutes()).padStart(2, '0');
    const seconds = String(timestamp.getUTCSeconds()).padStart(2, '0');
    const formattedTimestamp = `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;

    // ユーザーを「<@userId>」形式でメンション
    const userMention = `<@${userId}>`;

    // 成功/失敗の表示
    const statusIcon = result.success ? '✅' : '❌';
    const statusText = result.success ? '成功' : '失敗';

    // 基本的なログ構造
    let logMessage = `[${formattedTimestamp}] ${userMention}\n`;
    logMessage += `操作: ${operationInfo.operationType} - ${operationInfo.actionName}\n`;
    logMessage += `結果: ${statusIcon} ${statusText}\n`;

    // 失敗時のメッセージ
    if (!result.success && result.message) {
      logMessage += `エラー: ${result.message}\n`;
    }

    // 詳細情報の追加
    if (details || result.affectedItems !== undefined) {
      logMessage += '詳細:\n';
      
      if (result.affectedItems !== undefined) {
        logMessage += `- アイテム数: ${result.affectedItems}\n`;
      }

      if (details?.items && details.items.length > 0) {
        logMessage += '- 対象アイテム:\n';
        details.items.forEach(item => {
          logMessage += `  • ${item.name} (${item.quantity}個, ${item.category})`;
          if (item.until) {
            logMessage += ` - ${item.until.toLocaleDateString()}まで`;
          }
          logMessage += '\n';
        });
      }

      if (details?.changes) {
        // 新しい詳細形式（added/removed/modified）をサポート
        if (details.changes.added && details.changes.added.length > 0) {
          logMessage += `- 追加アイテム (${details.changes.added.length}件):\n`;
          details.changes.added.forEach(item => {
            logMessage += `  • ${item.name}`;
            if (item.category) logMessage += ` (${item.category})`;
            if (item.until) logMessage += ` - ${item.until.toLocaleDateString()}まで`;
            logMessage += '\n';
          });
        }

        if (details.changes.removed && details.changes.removed.length > 0) {
          logMessage += `- 削除アイテム (${details.changes.removed.length}件):\n`;
          details.changes.removed.forEach(item => {
            logMessage += `  • ${item.name}`;
            if (item.category) logMessage += ` (${item.category})`;
            logMessage += '\n';
          });
        }

        if (details.changes.modified && details.changes.modified.length > 0) {
          logMessage += `- 変更アイテム (${details.changes.modified.length}件):\n`;
          details.changes.modified.forEach(change => {
            logMessage += `  • ${change.name}:\n`;
            if (change.before.check !== undefined && change.after.check !== undefined) {
              logMessage += `    完了状態: ${change.before.check ? '完了' : '未完了'} → ${change.after.check ? '完了' : '未完了'}\n`;
            }
            if (change.before.category !== undefined && change.after.category !== undefined) {
              logMessage += `    カテゴリ: ${change.before.category || '未設定'} → ${change.after.category || '未設定'}\n`;
            }
            if (change.before.until !== undefined && change.after.until !== undefined) {
              const beforeDate = change.before.until ? change.before.until.toLocaleDateString() : '未設定';
              const afterDate = change.after.until ? change.after.until.toLocaleDateString() : '未設定';
              logMessage += `    期限: ${beforeDate} → ${afterDate}\n`;
            }
          });
        }

        // レガシー形式の変更内容もサポート（下位互換性のため）
        if (details.changes.before && details.changes.after) {
          logMessage += `- 変更前: ${JSON.stringify(details.changes.before)}\n`;
          logMessage += `- 変更後: ${JSON.stringify(details.changes.after)}\n`;
        }
      }

      if (details?.cancelReason) {
        logMessage += `- キャンセル理由: ${details.cancelReason}\n`;
      }
    }

    return logMessage.trim();
  }

  /**
   * 操作ログを記録する
   * @param channelId チャンネルID
   * @param operationInfo 操作情報
   * @param result 操作結果
   * @param userId ユーザーID
   * @param client Discord.jsクライアント
   * @param details 操作詳細（オプション）
   */
  public async logOperation(
    channelId: string,
    operationInfo: OperationInfo,
    result: OperationResult,
    userId: string,
    client: Client,
    details?: OperationDetails
  ): Promise<void> {
    try {
      // MetadataManagerからoperationLogThreadIdを取得
      const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
      
      if (!metadataResult.success || !metadataResult.metadata) {
        this.logger.warn('操作ログ記録時にメタデータが取得できませんでした', { channelId });
        return;
      }

      let threadId = metadataResult.metadata.operationLogThreadId;

      // operationLogThreadIdが存在しない場合、新しいスレッドを作成
      if (!threadId) {
        try {
          const thread = await this.createLogThread(channelId, client);
          threadId = thread.id;

          // メタデータを更新してoperationLogThreadIdを保存
          await this.metadataManager.updateChannelMetadata(channelId, {
            ...metadataResult.metadata,
            operationLogThreadId: threadId
          });
        } catch (error) {
          this.logger.error('操作ログスレッドの作成に失敗しました', { channelId, error });
          return;
        }
      }

      // スレッドを取得してログを投稿
      const fetchedChannel = await client.channels.fetch(threadId);
      if (!fetchedChannel) {
        this.logger.warn('操作ログスレッドが見つかりません', { channelId, threadId });
        return;
      }
      
      const thread = fetchedChannel as ThreadChannel;

      // ログメッセージをフォーマットして投稿
      const logMessage = this.formatLogMessage(operationInfo, result, userId, new Date(), details);
      await thread.send(logMessage);

      this.logger.debug('操作ログを記録しました', { 
        channelId, 
        threadId, 
        operationType: operationInfo.operationType,
        success: result.success 
      });

    } catch (error) {
      // 非侵襲的設計：例外を投げずにログ記録のみ
      this.logger.error('操作ログの記録に失敗しました', { 
        channelId, 
        operationType: operationInfo.operationType,
        error 
      });
    }
  }

  /**
   * 操作ログ用のスレッドを作成する
   * @param channelId チャンネルID
   * @param client Discord.jsクライアント
   * @returns 作成されたスレッド
   */
  public async createLogThread(channelId: string, client: Client): Promise<ThreadChannel> {
    // チャンネルを取得
    const channel = await client.channels.fetch(channelId);
    
    if (!channel) {
      throw new Error('チャンネルが見つかりません');
    }

    // テキストチャンネルかチェック
    if (channel.type !== ChannelType.GuildText) {
      throw new Error('テキストチャンネルではありません');
    }

    const textChannel = channel as TextChannel;

    // スレッドを作成
    const thread = await textChannel.threads.create({
      name: '操作ログ',
      autoArchiveDuration: 60 // 1時間でアーカイブ
    });

    this.logger.info('操作ログスレッドを作成しました', { 
      channelId, 
      threadId: thread.id,
      threadName: thread.name 
    });

    return thread;
  }
}