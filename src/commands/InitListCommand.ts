import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { ChannelSheetManager, ChannelSheetResult } from '../services/ChannelSheetManager';
import { MessageManager } from '../services/MessageManager';
import { MetadataManager } from '../services/MetadataManager';
import { ListFormatter } from '../ui/ListFormatter';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { ListItem } from '../models/ListItem';
import { normalizeCategory, validateCategory, DEFAULT_CATEGORY, CategoryType } from '../models/CategoryType';
import { SlashCommandBuilder, TextChannel } from 'discord.js';

export class InitListCommand extends BaseCommand {
  static getCommandName(): string {
    return 'init-list';
  }

  static getCommandDescription(): string {
    return 'リストの初期化を行います';
  }

  static getOptions(builder: SlashCommandBuilder): SlashCommandBuilder {
    return builder
      .addStringOption(option =>
        option.setName('default-category')
          .setDescription('デフォルトカテゴリーを設定します')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option.setName('enable-log')
          .setDescription('操作ログを有効にします')
          .setRequired(false)
      ) as SlashCommandBuilder;
  }

  private channelSheetManager: ChannelSheetManager;
  private messageManager: MessageManager;
  private metadataManager: MetadataManager;
  private googleSheetsService: GoogleSheetsService;

  constructor(
    logger: Logger,
    channelSheetManager?: ChannelSheetManager,
    messageManager?: MessageManager,
    metadataManager?: MetadataManager,
    googleSheetsService?: GoogleSheetsService
  ) {
    super('init-list', 'リストの初期化を行います', logger);
    this.deleteOnSuccess = true;
    this.ephemeral = true;
    this.channelSheetManager = channelSheetManager || new ChannelSheetManager();
    this.messageManager = messageManager || new MessageManager();
    this.metadataManager = metadataManager || new MetadataManager();
    this.googleSheetsService = googleSheetsService || GoogleSheetsService.getInstance();
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    this.logger.debug('Init list command started', {
      userId: context?.userId,
      guildId: context?.guildId,
      channelId: context?.channelId
    });

    try {
      // ステップ1: バリデーション
      this.validateExecutionContext(context);

      // ステップ2: スプレッドシートアクセス検証
      await this.verifySheetAccess();

      if (context?.channelId && context?.interaction) {
        // ステップ3-6: 初期化フロー実行
        await this.executeInitializationFlow(context);
      } else {
        await this.handleBasicInitialization(context);
      }

      this.logger.debug('Init list command completed');
    } catch (error) {
      this.handleExecutionError(error, context);
    }
  }

  private validateExecutionContext(context?: CommandExecutionContext): void {
    if (context?.interaction && !context.channelId) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'init-list',
        'Channel ID is required for list initialization',
        'チャンネルIDが必要です。'
      );
    }
  }

  private async executeInitializationFlow(context: CommandExecutionContext): Promise<void> {
    if (!context.channelId || !context.interaction) return;

    this.logger.debug('Executing initialization flow', {
      channelId: context.channelId,
      userId: context.userId
    });

    // オプションからデフォルトカテゴリーとenable-logを取得（ボタンインタラクションの場合はoptionsが存在しない）
    const defaultCategoryOption = context.interaction.options?.getString('default-category') || null;
    const enableLogOption = context.interaction.options?.getBoolean('enable-log');
    let defaultCategory = DEFAULT_CATEGORY;
    
    if (defaultCategoryOption) {
      // 引数がある場合：指定されたカテゴリーを使用
      try {
        defaultCategory = validateCategory(defaultCategoryOption);
      } catch (error) {
        throw new CommandError(
          CommandErrorType.INVALID_PARAMETERS,
          'init-list',
          '無効なデフォルトカテゴリー',
          error instanceof Error ? error.message : 'カテゴリーの検証に失敗しました。'
        );
      }
    } else {
      // 引数がない場合：既存メタデータから取得を試行
      try {
        const existingMetadata = await this.metadataManager.getChannelMetadata(context.channelId);
        if (existingMetadata.success && existingMetadata.metadata?.defaultCategory) {
          defaultCategory = existingMetadata.metadata.defaultCategory;
        }
        // 既存メタデータがない、またはdefaultCategoryが未設定の場合はDEFAULT_CATEGORYを使用（既に設定済み）
      } catch (error) {
        // メタデータ取得エラー時はDEFAULT_CATEGORYを使用（既に設定済み）
        this.logger.warn('Failed to get existing metadata for default category', {
          channelId: context.channelId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // チャンネルシートの準備
    await this.channelSheetManager.getOrCreateChannelSheet(context.channelId);

    // 操作ログスレッドの作成（enable-log=trueまたは未指定の場合のみ）
    let operationLogThreadId: string | undefined = undefined;
    if (enableLogOption !== false) { // true または null（デフォルト）の場合
      operationLogThreadId = await this.createOperationLogThread(context) || undefined;
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

    // ステップ4: Embed形式変換と固定メッセージ処理
    const embed = items.length > 0 
      ? await ListFormatter.formatDataList(listTitle, items, context.channelId, defaultCategory)
      : await ListFormatter.formatEmptyList(listTitle, context.channelId, undefined, defaultCategory);

    const messageResult = await this.messageManager.createOrUpdateMessageWithMetadata(
      context.channelId,
      embed,
      listTitle,
      context.interaction.client,
      'list',
      defaultCategory,
      operationLogThreadId
    );

    if (!messageResult.success) {
      throw new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'init-list',
        `Failed to create or update message: ${messageResult.errorMessage}`,
        'リストメッセージの作成・更新に失敗しました。'
      );
    }

    // ステップ5: メタデータ保存（MessageManagerで既に実行済み）
    this.logger.info('Metadata saved successfully', {
      channelId: context.channelId,
      messageId: messageResult.message?.id
    });

    // ステップ6: 完了通知メッセージ
    await this.sendCompletionMessage(context, items.length);
  }

  private async verifySheetAccess(): Promise<void> {
    try {
      const hasAccess = await this.googleSheetsService.checkSpreadsheetExists();
      if (!hasAccess) {
        throw new CommandError(
          CommandErrorType.PERMISSION_DENIED,
          'init-list',
          'Sheet access verification failed',
          'スプレッドシートへのアクセス権限がありません。'
        );
      }
    } catch (error) {
      if (error instanceof CommandError) {
        throw error;
      }
      
      // GoogleSheetsErrorの場合は詳細なエラー情報を提供
      if (error instanceof Error && error.name === 'GoogleSheetsError') {
        const gsError = error as Error & { userMessage?: string };
        throw new CommandError(
          CommandErrorType.PERMISSION_DENIED,
          'init-list',
          `Sheet access verification error: ${error.message}`,
          gsError.userMessage || 'スプレッドシートへのアクセス確認に失敗しました。'
        );
      }
      
      // OpenSSLエラーの場合は特別な処理
      if (error instanceof Error && (error.message.includes('ERR_OSSL_UNSUPPORTED') || error.message.includes('DECODER routines'))) {
        throw new CommandError(
          CommandErrorType.PERMISSION_DENIED,
          'init-list',
          `Authentication key format error: ${error.message}`,
          '認証キーの形式エラーが発生しました。\n' +
          'サーバー管理者に環境変数GOOGLE_PRIVATE_KEYの設定を確認するよう依頼してください。'
        );
      }
      
      throw new CommandError(
        CommandErrorType.PERMISSION_DENIED,
        'init-list',
        `Sheet access verification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'スプレッドシートへのアクセス確認に失敗しました。'
      );
    }
  }

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

          const item: ListItem = {
            name,
            category,
            until,
            check
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

  private isHeaderRow(row: (string | number)[]): boolean {
    const headers = ['name', 'category', 'until'];
    return headers.some(header => 
      row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes(header))
    );
  }

  private async sendCompletionMessage(context: CommandExecutionContext, itemCount: number): Promise<void> {
    if (!context.interaction) return;

    const message = `✅ スプレッドシートから${itemCount}件のアイテムを取得し、このチャンネルに表示しました`;
    await context.interaction.editReply({ content: message });
    
    this.logger.info('Completion message sent', {
      channelId: context.channelId,
      userId: context.userId,
      itemCount
    });
  }

  private logInitializationResult(context: CommandExecutionContext, result: ChannelSheetResult): void {
    this.logger.info('List initialization completed', {
      userId: context.userId,
      existed: result.existed,
      created: result.created
    });
  }

  private generateSuccessMessage(result: ChannelSheetResult): string {
    if (result.existed) {
      return '📋 既存のリストが見つかりました。初期化は完了しています。';
    } else {
      return '📋 新しいリストを作成し、初期化が完了しました！';
    }
  }

  private async handleBasicInitialization(context?: CommandExecutionContext): Promise<void> {
    this.logger.info('List initialization completed', {
      userId: context?.userId
    });

    if (context?.interaction) {
      await context.interaction.reply({
        content: '📋 リストの初期化が完了しました！',
        ephemeral: this.ephemeral
      });
    }
  }

  private async createOperationLogThread(context: CommandExecutionContext): Promise<string | null> {
    try {
      if (!context.interaction?.channel || !('threads' in context.interaction.channel)) {
        this.logger.debug('Channel does not support threads', {
          channelId: context.channelId
        });
        return null;
      }

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

  private handleExecutionError(error: unknown, context?: CommandExecutionContext): never {
    this.logger.error('Init list command failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: context?.userId,
      channelId: context?.channelId
    });

    if (error instanceof CommandError) {
      throw error;
    }

    throw new CommandError(
      CommandErrorType.EXECUTION_FAILED,
      'init-list',
      `List initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'リストの初期化に失敗しました。しばらく時間を置いてから再試行してください。'
    );
  }
}