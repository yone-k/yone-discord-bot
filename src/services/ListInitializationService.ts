import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { CommandExecutionContext } from '../base/BaseCommand';
import { ChannelSheetManager } from './ChannelSheetManager';
import { MessageManager } from './MessageManager';
import { MetadataManager } from './MetadataManager';
import { GoogleSheetsService } from './GoogleSheetsService';
import { ListFormatter } from '../ui/ListFormatter';
import { ListItem } from '../models/ListItem';
import { normalizeCategory, DEFAULT_CATEGORY, CategoryType } from '../models/CategoryType';
import { TextChannel, Message } from 'discord.js';

export interface ListInitializationResult {
  success: boolean;
  message?: Message;
  operationLogThreadId?: string;
  errorMessage?: string;
}

export class ListInitializationService {
  private logger: Logger;

  constructor(
    private googleSheetsService: GoogleSheetsService,
    private messageManager: MessageManager,
    private metadataManager: MetadataManager,
    private channelSheetManager: ChannelSheetManager
  ) {
    this.logger = new Logger();
  }

  /**
   * リストの初期化を実行する
   * @param context コマンド実行コンテキスト
   * @param enableLog 操作ログ制御 (true: 有効, false: 無効, null: 既存状態保持)
   * @param defaultCategory デフォルトカテゴリ
   * @returns 初期化結果
   */
  async initializeList(
    context: CommandExecutionContext,
    enableLog: boolean | null,
    defaultCategory: CategoryType
  ): Promise<ListInitializationResult> {
    if (!context.channelId || !context.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'list-initialization',
        'Invalid context parameters',
        'チャンネルIDまたはインタラクションが見つかりません。'
      );
    }

    this.logger.debug('Executing list initialization', {
      channelId: context.channelId,
      userId: context.userId,
      enableLog,
      defaultCategory
    });

    try {
      // ステップ1: チャンネルシートの準備
      await this.channelSheetManager.getOrCreateChannelSheet(context.channelId);

      // ステップ2: 操作ログスレッドIDの決定
      let operationLogThreadId: string | undefined = undefined;
      
      if (enableLog === true) {
        // 新しいスレッドを作成または既存スレッドを使用
        operationLogThreadId = await this.createOperationLogThread(context) || undefined;
      } else if (enableLog === false) {
        // 明示的に無効化（空文字列で削除指示）
        operationLogThreadId = '';
      } else if (enableLog === null) {
        // 既存状態を保持（同期ボタン用）
        const existingMetadata = await this.metadataManager.getChannelMetadata(context.channelId);
        if (existingMetadata.success && existingMetadata.metadata?.operationLogThreadId) {
          operationLogThreadId = existingMetadata.metadata.operationLogThreadId;
        } else {
          operationLogThreadId = '';
        }
      }

      // ステップ3: データ取得と検証
      const listData = await this.getAndValidateData(context.channelId);
      const items = this.convertToListItems(listData, defaultCategory);
      
      this.logger.info('Data retrieved and converted', {
        channelId: context.channelId,
        itemCount: items.length
      });

      // ステップ4: チャンネル名を取得してリストタイトルを動的生成
      const channelName = (context.interaction.channel && 'name' in context.interaction.channel) 
        ? context.interaction.channel.name 
        : 'リスト';
      const listTitle = `${channelName}リスト`;

      // ステップ5: Embed形式変換と固定メッセージ処理
      const content = items.length > 0 
        ? await ListFormatter.formatDataListContent(listTitle, items, context.channelId, defaultCategory)
        : await ListFormatter.formatEmptyListContent(listTitle, context.channelId, undefined, defaultCategory);
      const components = ListFormatter.buildListComponents(content);

      const messageResult = await this.messageManager.createOrUpdateMessageWithMetadataV2(
        context.channelId,
        components,
        listTitle,
        context.interaction.client,
        'list',
        defaultCategory,
        operationLogThreadId
      );

      if (!messageResult.success) {
        throw new CommandError(
          CommandErrorType.EXECUTION_FAILED,
          'list-initialization',
          `Failed to create or update message: ${messageResult.errorMessage}`,
          'リストメッセージの作成・更新に失敗しました。'
        );
      }

      // ステップ6: メタデータ保存（MessageManagerで既に実行済み）
      this.logger.info('List initialization completed successfully', {
        channelId: context.channelId,
        messageId: messageResult.message?.id,
        itemCount: items.length,
        operationLogThreadId
      });

      return {
        success: true,
        message: messageResult.message,
        operationLogThreadId: operationLogThreadId === '' ? undefined : operationLogThreadId
      };

    } catch (error) {
      this.logger.error('Failed to initialize list', {
        channelId: context.channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof CommandError) {
        throw error;
      }

      throw new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'list-initialization',
        error instanceof Error ? error.message : 'Unknown error',
        'リスト初期化中に予期しないエラーが発生しました。'
      );
    }
  }

  /**
   * 操作ログスレッドを作成または既存のものを取得する
   * @param context コマンド実行コンテキスト
   * @returns スレッドIDまたはnull
   */
  private async createOperationLogThread(context: CommandExecutionContext): Promise<string | null> {
    try {
      if (!context.interaction?.channel || !('threads' in context.interaction.channel)) {
        this.logger.debug('Channel does not support threads', {
          channelId: context.channelId
        });
        return null;
      }

      // 既存のスレッドIDをチェック
      if (!context.channelId) {
        this.logger.debug('Channel ID is not available', { context });
        return null;
      }
      
      const metadataResult = await this.metadataManager.getChannelMetadata(context.channelId);
      if (metadataResult.success && metadataResult.metadata?.operationLogThreadId) {
        const existingThreadId = metadataResult.metadata.operationLogThreadId;
        
        // 既存スレッドの有効性を確認
        try {
          const existingThread = await context.interaction!.client.channels.fetch(existingThreadId);
          if (existingThread && existingThread.isThread()) {
            this.logger.debug('Using existing operation log thread', {
              threadId: existingThreadId,
              channelId: context.channelId
            });
            return existingThreadId;
          } else {
            this.logger.debug('Existing thread is not valid, creating new one', {
              threadId: existingThreadId,
              channelId: context.channelId
            });
          }
        } catch (error) {
          this.logger.debug('Existing thread is not accessible, creating new one', {
            threadId: existingThreadId,
            channelId: context.channelId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // 新しいスレッドを作成
      const channel = context.interaction.channel as TextChannel;
      const thread = await channel.threads.create({
        name: '操作ログ',
        autoArchiveDuration: 1440, // 24時間
        reason: 'リスト操作の記録用スレッド'
      });

      this.logger.debug('Operation log thread created successfully', {
        threadId: thread.id,
        channelId: context.channelId
      });

      return thread.id;
    } catch (error) {
      // 非侵襲的なエラーハンドリング - エラーを投げずにログに記録
      this.logger.debug('Failed to create operation log thread', {
        channelId: context.channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Google Sheetsからデータを取得して検証する
   * @param channelId チャンネルID
   * @returns 正規化されたデータ
   */
  private async getAndValidateData(channelId: string): Promise<(string | number)[][]> {
    try {
      const data = await this.googleSheetsService.getSheetData(channelId);
      
      // データ検証
      const validation = this.googleSheetsService.validateData(data);
      if (!validation.isValid) {
        this.logger.warn('Data validation warnings', {
          channelId,
          errors: validation.errors
        });
      }

      // データ正規化
      const normalizedData = this.googleSheetsService.normalizeData(data);
      
      this.logger.debug('Data retrieved and validated', {
        channelId,
        originalRowCount: data.length,
        normalizedRowCount: normalizedData.length
      });

      return normalizedData;
    } catch (error) {
      this.logger.error('Failed to get and validate data', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // データ取得失敗時は空配列を返す（新規リストとして扱う）
      return [];
    }
  }

  /**
   * 生データをListItemに変換する
   * @param data 生データ
   * @param defaultCategory デフォルトカテゴリ
   * @returns ListItemの配列
   */
  private convertToListItems(data: (string | number)[][], defaultCategory?: CategoryType): ListItem[] {
    const items: ListItem[] = [];
    const seenNames = new Set<string>();
    
    // ヘッダー行をスキップ（存在する場合）
    const startIndex = data.length > 0 && this.isHeaderRow(data[0]) ? 1 : 0;
    
    for (let i = startIndex; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 1 && row[0]) { // name必須、最低限のデータ（name）がある行のみ
        try {
          const nameValue = row[0];
          const name = typeof nameValue === 'string' ? nameValue.trim() : String(nameValue);
          
          // nameでユニーク性をチェック
          if (seenNames.has(name)) {
            this.logger.warn('Duplicate name found, skipping', {
              rowIndex: i,
              name
            });
            continue;
          }
          seenNames.add(name);
          
          // until の安全な処理
          let until: Date | null = null;
          if (row.length > 2 && row[2]) {
            const untilValue = typeof row[2] === 'string' ? row[2].trim() : String(row[2]);
            if (untilValue !== '') {
              const dateValue = new Date(untilValue);
              until = !isNaN(dateValue.getTime()) ? dateValue : null;
            }
          }

          // カテゴリの処理：空の場合はdefaultCategoryを使用
          let category: CategoryType;
          if (row.length > 1 && row[1]) {
            const categoryValue = typeof row[1] === 'string' ? row[1].trim() : String(row[1]);
            if (categoryValue !== '') {
              category = normalizeCategory(categoryValue);
            } else {
              category = defaultCategory || DEFAULT_CATEGORY;
            }
          } else {
            category = defaultCategory || DEFAULT_CATEGORY;
          }

          // checkの処理：4列目がある場合は読み取り、'1'の場合のみtrue
          let check = false;
          if (row.length > 3 && row[3]) {
            const checkValue = typeof row[3] === 'string' ? row[3].trim() : String(row[3]);
            check = checkValue === '1';
          }

          // last_notified_atの処理：5列目がある場合は読み取り
          let lastNotifiedAt: Date | null = null;
          if (row.length > 4 && row[4]) {
            const notifiedValue = typeof row[4] === 'string' ? row[4].trim() : String(row[4]);
            if (notifiedValue !== '') {
              const dateValue = new Date(notifiedValue);
              lastNotifiedAt = !isNaN(dateValue.getTime()) ? dateValue : null;
            }
          }

          const item: ListItem = {
            name,
            category,
            until,
            check,
            lastNotifiedAt
          };
          
          items.push(item);
        } catch (error) {
          this.logger.warn('Failed to convert row to ListItem', {
            rowIndex: i,
            row,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
    
    return items;
  }

  /**
   * ヘッダー行かどうかを判定する
   * @param row 行データ
   * @returns ヘッダー行の場合true
   */
  private isHeaderRow(row: (string | number)[]): boolean {
    const headers = ['name', 'category', 'until', 'check', 'last_notified_at'];
    return headers.some(header => 
      row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes(header))
    );
  }
}
