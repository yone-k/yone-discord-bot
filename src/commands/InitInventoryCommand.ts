import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { Logger } from '../utils/logger';
import {
  InventoryInitializationService,
  type InitializationContext,
  type InventoryInitializationResult
} from '../services/InventoryInitializationService';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { InventoryMetadataManager } from '../services/InventoryMetadataManager';
import { InventoryMessageManager } from '../services/InventoryMessageManager';

interface InventoryInitializer {
  initializeInventory(context: InitializationContext): Promise<InventoryInitializationResult>;
}

export class InitInventoryCommand extends BaseCommand {
  static getCommandName(): string {
    return 'init-inventory';
  }

  static getCommandDescription(): string {
    return '在庫管理を初期化する';
  }

  constructor(
    logger: Logger,
    private readonly initializationService?: InventoryInitializer
  ) {
    super('init-inventory', '在庫管理を初期化する', logger);
    this.useThread = false;
    this.ephemeral = true;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'init-inventory',
        'Interaction is required',
        'インタラクションが必要です。'
      );
    }

    if (!context.channelId) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'init-inventory',
        'Channel ID is required',
        'チャンネルIDが必要です。'
      );
    }

    await context.interaction.deferReply({ flags: ['Ephemeral'] as const });

    const channelName = (context.interaction.channel && 'name' in context.interaction.channel)
      ? context.interaction.channel.name
      : '在庫';
    const result = await this.getInitializationService().initializeInventory({
      channelId: context.channelId,
      listTitle: `${channelName}の在庫`,
      client: context.interaction.client
    });

    if (!result.success) {
      await context.interaction.editReply({
        content: `在庫管理の初期化に失敗しました。${result.message ?? ''}`.trim()
      });
      return;
    }

    await context.interaction.deleteReply();
  }

  private getInitializationService(): InventoryInitializer {
    return this.initializationService ?? new InventoryInitializationService(
      GoogleSheetsService.getInstance(),
      InventoryMetadataManager.getInstance(),
      InventoryMessageManager.getInstance()
    );
  }
}
