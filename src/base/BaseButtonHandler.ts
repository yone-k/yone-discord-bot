import { ButtonInteraction } from 'discord.js';
import { Logger } from '../utils/logger';

export interface ButtonHandlerContext {
  interaction: ButtonInteraction;
}

export abstract class BaseButtonHandler {
  protected readonly customId: string;
  protected readonly logger: Logger;
  protected ephemeral: boolean = true;
  protected deleteOnSuccess: boolean = false;

  constructor(customId: string, logger: Logger) {
    this.customId = customId;
    this.logger = logger;
  }

  public async handle(context: ButtonHandlerContext): Promise<void> {
    try {
      if (!this.shouldHandle(context)) {
        return;
      }

      await this.executeAction(context);

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

  protected abstract executeAction(context: ButtonHandlerContext): Promise<void>;
}