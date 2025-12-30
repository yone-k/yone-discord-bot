import { ButtonInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { OperationResult, OperationInfo } from '../models/types/OperationLog';

export interface ButtonHandlerContext {
  interaction: ButtonInteraction;
}

export abstract class BaseButtonHandler {
  protected readonly customId: string;
  protected readonly logger: Logger;
  protected ephemeral: boolean = true;
  protected deleteOnSuccess: boolean = false;
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

  public async handle(context: ButtonHandlerContext): Promise<void> {
    try {
      if (!this.shouldHandle(context)) {
        return;
      }

      // 操作を実行してOperationResultを取得
      const result = await this.executeAction(context);

      // 操作ログの記録を試行
      await this.tryLogOperation(context, result);

      // 成功時にメッセージを削除
      if (this.deleteOnSuccess) {
        try {
          // 既にreplyしている場合は削除
          if (context.interaction.replied) {
            const reply = await context.interaction.fetchReply();
            await reply.delete();
          }
          // deferReplyしている場合はeditReplyして削除
          else if (context.interaction.deferred) {
            await context.interaction.editReply({ content: '処理が完了しました。', components: [] });
            const reply = await context.interaction.fetchReply();
            await reply.delete();
          }
        } catch (deleteError) {
          this.logger.warn('Failed to delete success message', {
            error: deleteError instanceof Error ? deleteError.message : 'Unknown error',
            customId: this.customId
          });
        }
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
        `Failed to handle button interaction for customId "${this.customId}"`,
        { 
          error: error instanceof Error ? error.message : 'Unknown error',
          userId: context.interaction.user.id,
          customId: context.interaction.customId
        }
      );
      
      try {
        if (!context.interaction.replied && !context.interaction.deferred) {
          await context.interaction.reply({
            content: 'エラーが発生しました。もう一度お試しください。',
            ephemeral: this.ephemeral
          });
        }
      } catch (replyError) {
        this.logger.warn('Failed to send error reply', {
          error: replyError instanceof Error ? replyError.message : 'Unknown error'
        });
      }
    }
  }

  public shouldHandle(context: ButtonHandlerContext): boolean {
    if (context.interaction.user.bot) {
      return false;
    }

    if (context.interaction.customId !== this.customId) {
      return false;
    }

    return true;
  }

  public getCustomId(): string {
    return this.customId;
  }

  /**
   * 操作ログの記録を試行する（非侵襲的）
   */
  private async tryLogOperation(context: ButtonHandlerContext, result: OperationResult): Promise<void> {
    try {
      // 操作ログサービスとメタデータマネージャーが注入されていない場合はスキップ
      if (!this.operationLogService || !this.metadataManager) {
        return;
      }

      // Add/Edit操作はモーダル表示のみで実際の処理は後で行われるため、ログ記録をスキップ
      if (this.shouldSkipLogging()) {
        return;
      }

      // guild、channelが存在しない場合はスキップ
      if (!context.interaction.guild || !context.interaction.channel) {
        return;
      }

      const channelId = context.interaction.channel.id;

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
        context.interaction.client
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

  /**
   * ログ記録をスキップするかどうかを判定する
   * Add/Edit操作はモーダル表示のみで実際の処理は後で行われるため、スキップする
   */
  protected shouldSkipLogging(): boolean {
    return this.customId === 'add-list-button' || this.customId === 'edit-list-button';
  }

  protected abstract executeAction(context: ButtonHandlerContext): Promise<OperationResult>;
  protected abstract getOperationInfo(context: ButtonHandlerContext): OperationInfo;
}
