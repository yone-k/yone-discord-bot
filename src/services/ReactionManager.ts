import { MessageReaction, User } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseReactionHandler, ReactionHandlerContext } from '../base/BaseReactionHandler';

export class ReactionManager {
  private handlers: Map<string, BaseReactionHandler> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public registerHandler(handler: BaseReactionHandler): void {
    const emojiName = handler.getEmojiName();
    
    if (this.handlers.has(emojiName)) {
      this.logger.warn(`Reaction handler for emoji "${emojiName}" is already registered, skipping`, {
        emojiName,
        existingHandler: this.handlers.get(emojiName)?.constructor.name,
        newHandler: handler.constructor.name
      });
      return;
    }

    this.handlers.set(emojiName, handler);
    this.logger.info(`Registered reaction handler for emoji "${emojiName}"`, {
      emojiName,
      handlerName: handler.constructor.name
    });
  }

  public async handleReaction(reaction: MessageReaction, user: User): Promise<void> {
    const emojiName = reaction.emoji.name;
    if (!emojiName) {
      this.logger.debug('Reaction has no emoji name, skipping');
      return;
    }

    const handler = this.handlers.get(emojiName);
    if (!handler) {
      this.logger.debug('No handler found for reaction emoji', {
        emoji: emojiName,
        availableEmojis: Array.from(this.handlers.keys())
      });
      return;
    }

    const context: ReactionHandlerContext = {
      reaction,
      user
    };

    try {
      await handler.handle(context);
    } catch (error) {
      this.logger.error('Error in reaction handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
        emoji: emojiName,
        handlerName: handler.constructor.name,
        userId: user.id,
        messageId: reaction.message.id
      });
    }
  }

  public getRegisteredHandlers(): BaseReactionHandler[] {
    return Array.from(this.handlers.values());
  }
}