import { StringSelectMenuInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { OperationLogService } from '../services/OperationLogService';
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

  public async handle(context: SelectMenuHandlerContext): Promise<void> {
    try {
      if (!this.shouldHandle(context)) {
        return;
      }

      const result = await this.executeAction(context);
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
        if (!context.interaction.replied && !context.interaction.deferred) {
          const replyOptions = this.ephemeral
            ? { content: 'エラーが発生しました。もう一度お試しください。', flags: ['Ephemeral'] as const }
            : { content: 'エラーが発生しました。もう一度お試しください。' };
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

  private async tryLogOperation(
    context: SelectMenuHandlerContext,
    result: OperationResult
  ): Promise<void> {
    try {
      if (!this.operationLogService || !this.metadataManager) {
        return;
      }

      if (this.shouldSkipLogging()) {
        return;
      }

      if (!context.interaction.guild || !context.interaction.channel) {
        return;
      }

      const channelId = context.interaction.channel.id;
      const metadataResult = await this.metadataManager.getChannelMetadata(channelId);

      if (!metadataResult.success || !metadataResult.metadata?.operationLogThreadId) {
        return;
      }

      const operationInfo = this.getOperationInfo(context);

      await this.operationLogService.logOperation(
        channelId,
        operationInfo,
        result,
        context.interaction.user.id,
        context.interaction.client
      );
    } catch (error) {
      this.logger.warn('Failed to log operation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        customId: this.customId,
        userId: context.interaction.user.id
      });
    }
  }

  protected shouldSkipLogging(): boolean {
    return false;
  }

  protected abstract executeAction(context: SelectMenuHandlerContext): Promise<OperationResult>;
  protected abstract getOperationInfo(context: SelectMenuHandlerContext): OperationInfo;
}
