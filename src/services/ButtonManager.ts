import { ButtonInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';

export class ButtonManager {
  private handlers: Map<string, BaseButtonHandler> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public registerHandler(handler: BaseButtonHandler): void {
    const customId = handler.getCustomId();
    
    if (this.handlers.has(customId)) {
      this.logger.warn(`Button handler for customId "${customId}" is already registered, skipping`, {
        customId,
        existingHandler: this.handlers.get(customId)?.constructor.name,
        newHandler: handler.constructor.name
      });
      return;
    }

    this.handlers.set(customId, handler);
    this.logger.info(`Registered button handler for customId "${customId}"`, {
      customId,
      handlerName: handler.constructor.name
    });
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    const handler = this.handlers.get(customId);
    if (!handler) {
      this.logger.debug('No handler found for button customId', {
        customId,
        availableCustomIds: Array.from(this.handlers.keys())
      });
      
      // ハンドラーが見つからない場合は簡単な応答を返す
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'この操作は現在利用できません。',
            ephemeral: true
          });
        }
      } catch (error) {
        this.logger.warn('Failed to send default response for unknown button', {
          error: error instanceof Error ? error.message : 'Unknown error',
          customId
        });
      }
      return;
    }

    const context: ButtonHandlerContext = {
      interaction
    };

    try {
      await handler.handle(context);
    } catch (error) {
      this.logger.error('Error in button handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
        customId,
        handlerName: handler.constructor.name,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
    }
  }

  public getRegisteredHandlers(): BaseButtonHandler[] {
    return Array.from(this.handlers.values());
  }

  public getHandlerByCustomId(customId: string): BaseButtonHandler | undefined {
    return this.handlers.get(customId);
  }

  public unregisterHandler(customId: string): boolean {
    const existed = this.handlers.has(customId);
    this.handlers.delete(customId);
    
    if (existed) {
      this.logger.info(`Unregistered button handler for customId "${customId}"`);
    }
    
    return existed;
  }
}