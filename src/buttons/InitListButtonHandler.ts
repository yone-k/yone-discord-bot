import { ChatInputCommandInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { InitListCommand } from '../commands/InitListCommand';
import { ListInitializationService } from '../services/ListInitializationService';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { MessageManager } from '../services/MessageManager';
import { ChannelSheetManager } from '../services/ChannelSheetManager';
import { CommandExecutionContext } from '../base/BaseCommand';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataManager } from '../services/MetadataManager';
import { DEFAULT_CATEGORY } from '../models/CategoryType';

export class InitListButtonHandler extends BaseButtonHandler {
  private initListCommand: InitListCommand;
  private listInitializationService: ListInitializationService;

  constructor(
    logger: Logger, 
    operationLogService?: OperationLogService,
    metadataManager?: MetadataManager,
    initListCommand?: InitListCommand,
    listInitializationService?: ListInitializationService
  ) {
    super('init-list-button', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.ephemeral = false;
    this.initListCommand = initListCommand || new InitListCommand(logger);
    
    // ListInitializationServiceの設定
    if (listInitializationService) {
      this.listInitializationService = listInitializationService;
    } else {
      const googleSheetsService = GoogleSheetsService.getInstance();
      const messageManager = new MessageManager();
      const channelSheetManager = new ChannelSheetManager();
      const defaultMetadataManager = metadataManager || MetadataManager.getInstance();
      
      this.listInitializationService = new ListInitializationService(
        googleSheetsService,
        messageManager,
        defaultMetadataManager,
        channelSheetManager
      );
    }
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'init',
      actionName: 'リスト初期化'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    try {
      await context.interaction.deferReply({ ephemeral: this.ephemeral });

      const commandContext: CommandExecutionContext = {
        interaction: context.interaction as unknown as ChatInputCommandInteraction,
        userId: context.interaction.user.id,
        guildId: context.interaction.guildId ?? undefined,
        channelId: context.interaction.channelId ?? undefined
      };

      if (!commandContext.channelId) {
        throw new Error('チャンネルIDが取得できませんでした');
      }

      // 既存メタデータからデフォルトカテゴリを取得
      let defaultCategory = DEFAULT_CATEGORY;
      try {
        const existingMetadata = await this.metadataManager!.getChannelMetadata(commandContext.channelId);
        if (existingMetadata.success && existingMetadata.metadata?.defaultCategory) {
          defaultCategory = existingMetadata.metadata.defaultCategory;
        }
      } catch (error) {
        this.logger.warn('Failed to get existing metadata for default category', {
          channelId: commandContext.channelId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // ListInitializationServiceを使用してリスト同期（操作ログは既存状態保持）
      const result = await this.listInitializationService.initializeList(
        commandContext,
        null, // null = 既存状態保持（同期ボタン用）
        defaultCategory
      );

      if (!result.success) {
        throw new Error(result.errorMessage || 'リスト同期に失敗しました');
      }

      await context.interaction.editReply({
        content: '✅ リストの同期が完了しました！'
      });

      // 実際の件数を取得するため、簡単なデータ取得を試行
      let itemCount = 0;
      try {
        const googleSheetsService = GoogleSheetsService.getInstance();
        const listData = await googleSheetsService.getSheetData(commandContext.channelId);
        const normalizedData = googleSheetsService.normalizeData(listData);
        
        // ヘッダー行をスキップして件数をカウント
        const startIndex = normalizedData.length > 0 && this.isHeaderRow(normalizedData[0]) ? 1 : 0;
        itemCount = normalizedData.length - startIndex;
      } catch (error) {
        this.logger.warn('Failed to get item count', {
          channelId: commandContext.channelId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      return {
        success: true,
        message: 'リストを同期しました',
        affectedItems: itemCount
      };
    } catch (error) {
      // エラーレスポンスを返す
      try {
        if (context.interaction.deferred) {
          await context.interaction.editReply({
            content: 'リストの同期に失敗しました。もう一度お試しください。'
          });
        }
      } catch (replyError) {
        this.logger.warn('Failed to send error reply', {
          error: replyError instanceof Error ? replyError.message : 'Unknown error'
        });
      }

      const isCancel = error instanceof Error && error.message.includes('cancelled');
      const result: OperationResult = {
        success: false,
        message: '同期に失敗しました',
        error: error instanceof Error ? error : new Error('未知のエラー')
      };
      
      if (isCancel) {
        result.details = {
          cancelReason: 'ユーザーによる同期キャンセル'
        };
      }
      
      return result;
    }
  }

  /**
   * ヘッダー行かどうかを判定する
   * @param row 行データ
   * @returns ヘッダー行の場合true
   */
  private isHeaderRow(row: (string | number)[]): boolean {
    const headers = ['name', 'category', 'until'];
    return headers.some(header => 
      row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes(header))
    );
  }
}