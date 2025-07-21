import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { ChannelSheetManager, ChannelSheetResult } from '../services/ChannelSheetManager';
import { MessageManager } from '../services/MessageManager';
import { MetadataManager } from '../services/MetadataManager';
import { ListFormatter } from '../ui/ListFormatter';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { ListItem } from '../models/ListItem';
import { normalizeCategory } from '../models/CategoryType';

export class InitListCommand extends BaseCommand {
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
      
      if (context?.interaction) {
        await context.interaction.deferReply();
      }

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

    // チャンネルシートの準備
    await this.channelSheetManager.getOrCreateChannelSheet(context.channelId);

    // ステップ3: データ取得と検証
    const listData = await this.getAndValidateData(context.channelId);
    const items = this.convertToListItems(listData);
    
    this.logger.info('Data retrieved and converted', {
      channelId: context.channelId,
      itemCount: items.length
    });

    // ステップ4: Embed形式変換と固定メッセージ処理
    const embed = items.length > 0 
      ? ListFormatter.formatDataList('ショッピングリスト', items)
      : ListFormatter.formatEmptyList('ショッピングリスト');

    const messageResult = await this.messageManager.createOrUpdateMessageWithMetadata(
      context.channelId,
      embed,
      'ショッピングリスト',
      'shopping',
      context.interaction.client
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
      throw new CommandError(
        CommandErrorType.PERMISSION_DENIED,
        'init-list',
        `Sheet access verification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'スプレッドシートへのアクセス確認に失敗しました。'
      );
    }
  }

  private async getAndValidateData(channelId: string): Promise<string[][]> {
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

  private convertToListItems(data: string[][]): ListItem[] {
    const items: ListItem[] = [];
    
    // ヘッダー行をスキップ（存在する場合）
    const startIndex = data.length > 0 && this.isHeaderRow(data[0]) ? 1 : 0;
    
    for (let i = startIndex; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 5 && row[0] && row[1]) { // 最低限のデータがある行のみ
        try {
          const item: ListItem = {
            id: row[0]?.trim() || `legacy-${Date.now()}-${i}`,
            name: row[1].trim(),
            quantity: parseInt(row[2], 10) || 1,
            category: normalizeCategory(row[3] || 'other'),
            addedAt: row[4] ? new Date(row[4]) : new Date()
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

  private isHeaderRow(row: string[]): boolean {
    const headers = ['id', 'name', 'quantity', 'category', 'added_at'];
    return headers.some(header => 
      row.some(cell => cell.toLowerCase().includes(header))
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
        ephemeral: false
      });
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