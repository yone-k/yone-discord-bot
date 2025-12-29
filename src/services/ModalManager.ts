import { ModalSubmitInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';

export class ModalManager {
  private handlers: Map<string, BaseModalHandler> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public registerHandler(handler: BaseModalHandler): void {
    const customId = handler.getCustomId();
    
    if (this.handlers.has(customId)) {
      this.logger.warn(`Modal handler for customId "${customId}" is already registered, skipping`, {
        customId,
        existingHandler: this.handlers.get(customId)?.constructor.name,
        newHandler: handler.constructor.name
      });
      return;
    }

    this.handlers.set(customId, handler);
    this.logger.info(`Registered modal handler for customId "${customId}"`, {
      customId,
      handlerName: handler.constructor.name
    });
  }

  public async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const customId = interaction.customId;
    let handler = this.handlers.get(customId);

    if (!handler) {
      const context: ModalHandlerContext = { interaction };
      handler = Array.from(this.handlers.values()).find(candidate => candidate.shouldHandle(context));
    }

    if (!handler) {
      this.logger.debug('No handler found for modal customId', {
        customId,
        availableCustomIds: Array.from(this.handlers.keys())
      });
      return;
    }

    const context: ModalHandlerContext = {
      interaction
    };

    try {
      await handler.handle(context);
    } catch (error) {
      this.logger.error('Error in modal handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
        customId,
        handlerName: handler.constructor.name,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId
      });
    }
  }

  public getRegisteredHandlers(): BaseModalHandler[] {
    return Array.from(this.handlers.values());
  }
}
