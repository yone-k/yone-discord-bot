import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { RemindChannelStore, type RemindChannelMetadata } from '../services/RemindChannelStore';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { Logger } from '../utils/logger';

interface RemindMetadataReaderUpdater {
  getChannelMetadata(channelId: string): Promise<{
    success: boolean;
    metadata?: RemindChannelMetadata;
    message?: string;
  }>;
  updateChannelMetadata(
    channelId: string,
    updates: { linkedInventoryChannelId?: string }
  ): Promise<{ success: boolean; message?: string }>;
}

export class UnlinkInventoryCommand extends BaseCommand {
  static getCommandName(): string {
    return 'unlink-inventory';
  }

  static getCommandDescription(): string {
    return '在庫チャンネルとのリンクを解除する';
  }

  private readonly remindMetadataManager: RemindMetadataReaderUpdater;

  constructor(
    logger: Logger,
    remindMetadataManager: RemindMetadataReaderUpdater = RemindChannelStore.getInstance()
  ) {
    super('unlink-inventory', '在庫チャンネルとのリンクを解除する', logger);
    this.ephemeral = true;
    this.useThread = false;
    this.remindMetadataManager = remindMetadataManager;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'unlink-inventory',
        'Interaction is required',
        'インタラクションが必要です。'
      );
    }

    if (!context.channelId) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'unlink-inventory',
        'Channel ID is required',
        'チャンネルIDが必要です。'
      );
    }

    await context.interaction.deferReply({ flags: ['Ephemeral'] as const });

    const current = await this.remindMetadataManager.getChannelMetadata(context.channelId);
    if (!current.success) {
      const message = current.message || 'metadataが見つかりません';
      await context.interaction.editReply({
        content: `在庫チャンネルのリンク解除に失敗しました。${message}`
      });
      throw new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'unlink-inventory',
        message,
        '在庫チャンネルのリンク解除に失敗しました。'
      );
    }

    if (!current.metadata?.linkedInventoryChannelId) {
      await context.interaction.editReply({
        content: 'リンクされている在庫チャンネルはありません。'
      });
      return;
    }

    const result = await this.remindMetadataManager.updateChannelMetadata(
      context.channelId,
      { linkedInventoryChannelId: undefined }
    );

    if (!result.success) {
      const message = result.message || 'Failed to unlink inventory channel';
      await context.interaction.editReply({
        content: `在庫チャンネルのリンク解除に失敗しました。${message}`
      });
      throw new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'unlink-inventory',
        message,
        '在庫チャンネルのリンク解除に失敗しました。'
      );
    }

    await context.interaction.editReply({
      content: '在庫チャンネルのリンクを解除しました。'
    });
  }
}
