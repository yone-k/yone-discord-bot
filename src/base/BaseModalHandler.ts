import { CoreApiError, withInteractionOutput } from '../api/CoreClient';
import { ModalSubmitInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { UiOperationEvents } from '../services/UiOperationEvents';
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
  protected operationLogService?: UiOperationEvents;
  protected metadataManager?: MetadataProvider;

  constructor(
    customId: string, 
    logger: Logger, 
    operationLogService?: UiOperationEvents,
    metadataManager?: MetadataProvider
  ) {
    this.customId = customId;
    this.logger = logger;
    this.operationLogService = operationLogService;
    this.metadataManager = metadataManager;
  }

  public handle(context: ModalHandlerContext): Promise<void> {
    return withInteractionOutput(context.interaction, this.constructor.name, () => this.handleInteraction(context));
  }

  private async handleInteraction(context: ModalHandlerContext): Promise<void> {
    try {
      if (!this.shouldHandle(context)) {
        return;
      }

      const deferOptions = this.ephemeral ? { flags: ['Ephemeral'] as const } : {};
      await context.interaction.deferReply(deferOptions);

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
              await context.interaction.deleteReply();
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
          content: error instanceof CoreApiError ? `❌ ${error.message}` : '❌ 処理中にエラーが発生しました。しばらく時間を置いてから再試行してください。'
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
    if (!this.operationLogService) return;
    try {
      await this.operationLogService.record(context.interaction, this.constructor.name, result);
    } catch {
      this.logger.warn('Failed to record UI operation', { customId: this.customId });
    }
  }

  protected abstract executeAction(context: ModalHandlerContext): Promise<OperationResult>;
  protected abstract getOperationInfo(context: ModalHandlerContext): OperationInfo;
  protected abstract getSuccessMessage(): string;
}
