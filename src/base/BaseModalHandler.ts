import { ModalSubmitInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { OperationResult, OperationInfo } from '../models/types/OperationLog';

export interface ModalHandlerContext {
  interaction: ModalSubmitInteraction;
}

export abstract class BaseModalHandler {
  protected readonly customId: string;
  protected readonly logger: Logger;
  protected ephemeral: boolean = true;
  protected deleteOnSuccess: boolean = false;
  protected deleteOnFailure: boolean = false;
  protected silentOnSuccess: boolean = false;
  protected silentOnFailure: boolean = false;
  protected operationLogService?: OperationLogService;
  protected metadataManager?: MetadataProvider;

  constructor(
    customId: string, 
    logger: Logger, 
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    this.customId = customId;
    this.logger = logger;
    this.operationLogService = operationLogService;
    this.metadataManager = metadataManager;
  }

  public async handle(context: ModalHandlerContext): Promise<void> {
    try {
      if (!this.shouldHandle(context)) {
        return;
      }

      await context.interaction.deferReply({ ephemeral: this.ephemeral });

      // 操作を実行してOperationResultを取得
      const result = await this.executeAction(context);

      // 操作ログの記録を試行
      await this.tryLogOperation(context, result);

      const shouldDeleteOnSuccess = this.deleteOnSuccess && result.success;
      const shouldDeleteOnFailure = this.deleteOnFailure && !result.success;
      const shouldDelete = shouldDeleteOnSuccess || shouldDeleteOnFailure;

      // 成功時/失敗時にメッセージを削除
      if (shouldDelete) {
        try {
          const shouldSilent =
            (shouldDeleteOnSuccess && this.silentOnSuccess) ||
            (shouldDeleteOnFailure && this.silentOnFailure);

          if (shouldSilent) {
            await context.interaction.deleteReply();
          } else {
            await context.interaction.editReply({
              content: result.success ? '処理が完了しました。' : (result.message || 'エラーが発生しました')
            });
            try {
              const reply = await context.interaction.fetchReply();
              await reply.delete();
            } catch (delayedDeleteError) {
              this.logger.warn('Failed to delete modal message', {
                error: delayedDeleteError instanceof Error ? delayedDeleteError.message : 'Unknown error',
                customId: this.customId
              });
            }
          }
        } catch (deleteError) {
          this.logger.warn('Failed to delete modal message', {
            error: deleteError instanceof Error ? deleteError.message : 'Unknown error',
            customId: this.customId
          });
        }
      } else {
        await context.interaction.editReply({
          content: result.success ? this.getSuccessMessage() : (result.message || 'エラーが発生しました')
        });
      }
    } catch (error) {
      // executeActionでエラーが発生した場合の操作ログ記録
      const failureResult: OperationResult = {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        error: error instanceof Error ? error : new Error('Unknown error')
      };
      
      await this.tryLogOperation(context, failureResult);

      this.logger.error(
        `Failed to handle modal submission for customId "${this.customId}"`,
        { 
          error: error instanceof Error ? error.message : 'Unknown error',
          userId: context.interaction.user.id,
          guildId: context.interaction.guildId,
          channelId: context.interaction.channelId
        }
      );
      
      try {
        await context.interaction.editReply({
          content: '❌ 処理中にエラーが発生しました。しばらく時間を置いてから再試行してください。'
        });
      } catch (replyError) {
        this.logger.error('Failed to send modal response', {
          error: replyError instanceof Error ? replyError.message : 'Unknown error'
        });
      }
    }
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId === this.customId;
  }

  public getCustomId(): string {
    return this.customId;
  }

  /**
   * 操作ログの記録を試行する（非侵襲的）
   */
  private async tryLogOperation(context: ModalHandlerContext, result: OperationResult): Promise<void> {
    try {
      // 操作ログサービスとメタデータマネージャーが注入されていない場合はスキップ
      if (!this.operationLogService || !this.metadataManager) {
        return;
      }

      // guild、channelが存在しない場合はスキップ
      if (!context.interaction.guild || !context.interaction.channelId) {
        return;
      }

      const channelId = context.interaction.channelId;

      // MetadataManagerからoperationLogThreadIdを取得
      const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
      
      if (!metadataResult.success || !metadataResult.metadata?.operationLogThreadId) {
        // operationLogThreadIdが存在しない場合はログ記録をスキップ
        return;
      }

      // 操作情報を取得
      const operationInfo = this.getOperationInfo(context);

      // 操作ログを記録
      await this.operationLogService.logOperation(
        channelId,
        operationInfo, 
        result,
        context.interaction.user.id,
        context.interaction.client,
        result.details
      );

    } catch (error) {
      // 非侵襲的設計：例外を投げずに警告ログのみ記録
      this.logger.warn('Failed to log operation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        customId: this.customId,
        userId: context.interaction.user.id
      });
    }
  }

  protected abstract executeAction(context: ModalHandlerContext): Promise<OperationResult>;
  protected abstract getOperationInfo(context: ModalHandlerContext): OperationInfo;
  protected abstract getSuccessMessage(): string;
}
