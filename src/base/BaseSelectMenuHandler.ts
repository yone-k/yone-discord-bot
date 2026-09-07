import { withInteractionDeadline, withInteractionOutput, CoreApiError } from '../api/CoreClient';
import { StringSelectMenuInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { MetadataProvider } from '../services/MetadataProvider';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';

export interface SelectMenuHandlerContext {
  interaction: StringSelectMenuInteraction;
}

export abstract class BaseSelectMenuHandler {
  protected readonly customId: string;
  protected readonly logger: Logger;
  protected ephemeral: boolean = true;
  protected deleteOnSuccess: boolean = false;
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

  public handle(context: SelectMenuHandlerContext): Promise<void> {
    return withInteractionOutput(context.interaction, this.constructor.name, () => this.handleInteraction(context));
  }

  private async handleInteraction(context: SelectMenuHandlerContext): Promise<void> {
    try {
      if (!this.shouldHandle(context)) {
        return;
      }

      const result = await withInteractionDeadline(context.interaction, () => this.executeAction(context));
      await this.tryLogOperation(context, result);

      if (this.deleteOnSuccess && result.success) {
        try {
          if (context.interaction.replied) {
            const reply = await context.interaction.fetchReply();
            await reply.delete();
          } else if (context.interaction.deferred) {
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
      const failureResult: OperationResult = {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        error: error instanceof Error ? error : new Error('Unknown error')
      };

      await this.tryLogOperation(context, failureResult);

      this.logger.error(
        `Failed to handle select menu interaction for customId "${this.customId}"`,
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId: context.interaction.user.id,
          customId: context.interaction.customId
        }
      );

      try {
        if (error instanceof CoreApiError && context.interaction.deferred) {
          await context.interaction.editReply({ content: error.message });
        } else if (error instanceof CoreApiError && context.interaction.replied) {
          await context.interaction.followUp({ content: error.message, flags: ['Ephemeral'] as const });
        } else if (!context.interaction.replied && !context.interaction.deferred) {
          const replyOptions = this.ephemeral
            ? { content: error instanceof CoreApiError ? error.message : 'エラーが発生しました。もう一度お試しください。', flags: ['Ephemeral'] as const }
            : { content: error instanceof CoreApiError ? error.message : 'エラーが発生しました。もう一度お試しください。' };
          await context.interaction.reply(replyOptions);
        }
      } catch (replyError) {
        this.logger.warn('Failed to send error reply', {
          error: replyError instanceof Error ? replyError.message : 'Unknown error'
        });
      }
    }
  }

  public shouldHandle(context: SelectMenuHandlerContext): boolean {
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

  private async tryLogOperation(context: SelectMenuHandlerContext, result: OperationResult): Promise<void> {
    if (!this.operationLogService || this.shouldSkipLogging()) return;
    try {
      await this.operationLogService.record(context.interaction, this.constructor.name, result);
    } catch {
      this.logger.warn('Failed to record UI operation', { customId: this.customId });
    }
  }

  protected shouldSkipLogging(): boolean {
    return false;
  }

  protected abstract executeAction(context: SelectMenuHandlerContext): Promise<OperationResult>;
  protected abstract getOperationInfo(context: SelectMenuHandlerContext): OperationInfo;
}
