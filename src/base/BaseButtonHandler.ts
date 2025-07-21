import { ButtonInteraction } from 'discord.js';
import { Logger } from '../utils/logger';

export interface ButtonHandlerContext {
  interaction: ButtonInteraction;
}

export abstract class BaseButtonHandler {
  protected readonly customId: string;
  protected readonly logger: Logger;

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
            ephemeral: true
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