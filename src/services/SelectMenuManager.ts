import { StringSelectMenuInteraction } from 'discord.js';
import { BaseSelectMenuHandler, SelectMenuHandlerContext } from '../base/BaseSelectMenuHandler';
import { Logger } from '../utils/logger';
import { OperationLogService } from './OperationLogService';
import { MetadataManager } from './MetadataManager';

export class SelectMenuManager {
  private handlers: Map<string, BaseSelectMenuHandler> = new Map();
  private logger: Logger;
  private operationLogService?: OperationLogService;
  private metadataManager?: MetadataManager;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataManager
  ) {
    this.logger = logger;
    this.operationLogService = operationLogService;
    this.metadataManager = metadataManager;
  }

  public registerHandler(handler: BaseSelectMenuHandler): void {
    const customId = handler.getCustomId();

    if (this.handlers.has(customId)) {
      this.logger.warn(`Select menu handler for customId "${customId}" is already registered, skipping`, {
        customId,
        existingHandler: this.handlers.get(customId)?.constructor.name,
        newHandler: handler.constructor.name
      });
      return;
    }

    this.handlers.set(customId, handler);
    this.logger.info(`Registered select menu handler for customId "${customId}"`, {
      customId,
      handlerName: handler.constructor.name
    });
  }

  public getOperationLogService(): OperationLogService | undefined {
    return this.operationLogService;
  }

  public getMetadataManager(): MetadataManager | undefined {
    return this.metadataManager;
  }

  public async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    const customId = interaction.customId;
    let handler = this.handlers.get(customId);
    if (!handler) {
      const context: SelectMenuHandlerContext = { interaction };
      handler = Array.from(this.handlers.values()).find(candidate => candidate.shouldHandle(context));
    }

    if (!handler) {
      this.logger.debug('No handler found for select menu customId', {
        customId,
        availableCustomIds: Array.from(this.handlers.keys())
      });
      return;
    }

    const context: SelectMenuHandlerContext = { interaction };

    try {
      await handler.handle(context);
    } catch (error) {
      this.logger.error('Error in select menu handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
        customId,
        handlerName: handler.constructor.name,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
    }
  }

  public getRegisteredHandlers(): BaseSelectMenuHandler[] {
    return Array.from(this.handlers.values());
  }

  public getHandlerByCustomId(customId: string): BaseSelectMenuHandler | undefined {
    return this.handlers.get(customId);
  }

  public unregisterHandler(customId: string): boolean {
    const existed = this.handlers.has(customId);
    this.handlers.delete(customId);

    if (existed) {
      this.logger.info(`Unregistered select menu handler for customId "${customId}"`);
    }

    return existed;
  }
}
