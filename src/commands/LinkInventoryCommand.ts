import { SlashCommandBuilder } from 'discord.js';
import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { InventoryChannelStore, type InventoryChannelMetadata } from '../services/InventoryChannelStore';
import { RemindChannelStore } from '../services/RemindChannelStore';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { Logger } from '../utils/logger';

type InventoryMetadataLookupResult =
  | InventoryChannelMetadata
  | null
  | {
    success: boolean;
    metadata?: InventoryChannelMetadata;
    message?: string;
  };

interface InventoryMetadataReader {
  getChannelMetadata(channelId: string): Promise<InventoryMetadataLookupResult>;
}

interface RemindMetadataUpdater {
  updateChannelMetadata(
    channelId: string,
    updates: { linkedInventoryChannelId?: string }
  ): Promise<{ success: boolean; message?: string }>;
}

export class LinkInventoryCommand extends BaseCommand {
  static getCommandName(): string {
    return 'link-inventory';
  }

  static getCommandDescription(): string {
    return '在庫チャンネルとリンクする';
  }

  static getOptions(builder: SlashCommandBuilder): SlashCommandBuilder {
    return builder.addChannelOption(option =>
      option
        .setName('inventory-channel')
        .setDescription('リンクする在庫チャンネル')
        .setRequired(true)
    ) as SlashCommandBuilder;
  }

  private readonly remindMetadataManager: RemindMetadataUpdater;
  private readonly inventoryMetadataManager: InventoryMetadataReader;

  constructor(
    logger: Logger,
    remindMetadataManager: RemindMetadataUpdater = RemindChannelStore.getInstance(),
    inventoryMetadataManager: InventoryMetadataReader = InventoryChannelStore.getInstance()
  ) {
    super('link-inventory', '在庫チャンネルとリンクする', logger);
    this.ephemeral = true;
    this.useThread = false;
    this.remindMetadataManager = remindMetadataManager;
    this.inventoryMetadataManager = inventoryMetadataManager;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'link-inventory',
        'Interaction is required',
        'インタラクションが必要です。'
      );
    }

    if (!context.channelId) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'link-inventory',
        'Channel ID is required',
        'チャンネルIDが必要です。'
      );
    }

    await context.interaction.deferReply({ flags: ['Ephemeral'] as const });

    const inventoryChannel = context.interaction.options.getChannel('inventory-channel');
    if (!inventoryChannel) {
      await context.interaction.editReply({
        content: 'inventory-channel を指定してください。'
      });
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'link-inventory',
        'inventory-channel is required',
        'inventory-channel を指定してください。'
      );
    }

    const inventoryMetadata = await this.inventoryMetadataManager.getChannelMetadata(inventoryChannel.id);
    if (!this.isInitializedInventoryChannel(inventoryMetadata)) {
      await context.interaction.editReply({
        content: 'リンク先の在庫チャンネルで /init-inventory を実行してください。'
      });
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'link-inventory',
        'Inventory channel is not initialized',
        'リンク先の在庫チャンネルで /init-inventory を実行してください。'
      );
    }

    const result = await this.remindMetadataManager.updateChannelMetadata(
      context.channelId,
      { linkedInventoryChannelId: inventoryChannel.id }
    );

    if (!result.success) {
      const message = result.message || 'Failed to link inventory channel';
      await context.interaction.editReply({
        content: `在庫チャンネルのリンクに失敗しました。${message}`
      });
      throw new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'link-inventory',
        message,
        '在庫チャンネルのリンクに失敗しました。'
      );
    }

    await context.interaction.editReply({
      content: '在庫チャンネルをリンクしました。'
    });
  }

  private isInitializedInventoryChannel(result: InventoryMetadataLookupResult): boolean {
    if (!result) {
      return false;
    }

    if ('success' in result) {
      return result.success && result.metadata !== undefined;
    }

    return true;
  }
}
