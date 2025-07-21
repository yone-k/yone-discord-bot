import { MessageReaction, User, ModalBuilder } from 'discord.js';
import { Logger } from '../utils/logger';

export interface ReactionHandlerContext {
  reaction: MessageReaction;
  user: User;
}

export abstract class BaseReactionHandler {
  protected readonly emojiName: string;
  protected readonly logger: Logger;

  constructor(emojiName: string, logger: Logger) {
    this.emojiName = emojiName;
    this.logger = logger;
  }

  public async handle(context: ReactionHandlerContext): Promise<void> {
    try {
      if (!this.shouldHandle(context)) {
        return;
      }

      await this.showModal(context);
      await context.reaction.users.remove(context.user.id);
    } catch (error) {
      this.logger.error(
        `Failed to handle reaction for emoji "${this.emojiName}"`,
        { 
          error: error instanceof Error ? error.message : 'Unknown error',
          userId: context.user.id,
          messageId: context.reaction.message.id
        }
      );
      
      try {
        await context.reaction.users.remove(context.user.id);
      } catch (removeError) {
        this.logger.warn('Failed to remove reaction after error', {
          error: removeError instanceof Error ? removeError.message : 'Unknown error'
        });
      }
    }
  }

  public shouldHandle(context: ReactionHandlerContext): boolean {
    if (context.user.bot) {
      return false;
    }

    if (context.reaction.emoji.name !== this.emojiName) {
      return false;
    }

    return true;
  }

  public getEmojiName(): string {
    return this.emojiName;
  }

  protected abstract createModal(context: ReactionHandlerContext): Promise<ModalBuilder>;

  private async showModal(context: ReactionHandlerContext): Promise<void> {
    const modal = await this.createModal(context);
    
    if (context.reaction.message.interaction && 'showModal' in context.reaction.message.interaction) {
      const interaction = context.reaction.message.interaction as { showModal: (modal: ModalBuilder) => Promise<void> };
      await interaction.showModal(modal);
    } else {
      this.logger.warn('Cannot show modal: no interaction available');
    }
  }
}