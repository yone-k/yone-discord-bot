import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

export class DeleteAllMessageCommand extends BaseCommand {
  static getCommandName(): string {
    return 'delete-all-message';
  }

  static getCommandDescription(): string {
    return 'チャンネル内のすべてのメッセージを削除します';
  }

  constructor(logger: Logger) {
    super('delete-all-message', 'チャンネル内のすべてのメッセージを削除します', logger);
    this.deleteOnSuccess = true;
    this.useThread = false;
    this.ephemeral = false;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    this.logger.debug('Delete all message command started', {
      userId: context?.userId,
      guildId: context?.guildId,
      channelId: context?.channelId
    });

    if (!context?.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'delete-all-message',
        'Interaction is required',
        'インタラクションが必要です。'
      );
    }

    if (!context.interaction.guild) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'delete-all-message',
        'Guild is required',
        'このコマンドはサーバー内でのみ使用できます。'
      );
    }

    try {
      // ユーザーの権限をチェック
      const member = await context.interaction.guild.members.fetch(context.userId!);
      
      if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        throw new CommandError(
          CommandErrorType.PERMISSION_DENIED,
          'delete-all-message',
          'User does not have ManageMessages permission',
          'メッセージを削除する権限がありません。'
        );
      }

      // 確認モーダルを表示
      await this.showConfirmationModal(context);

      this.logger.info('Delete all message command: confirmation modal shown', {
        userId: context.userId,
        channelId: context.channelId
      });

    } catch (error) {
      if (error instanceof CommandError) {
        throw error;
      }

      this.logger.error('Failed to execute delete all message command', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: context.userId,
        channelId: context.channelId
      });

      throw new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'delete-all-message',
        `Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'コマンドの実行に失敗しました。'
      );
    }
  }

  private async showConfirmationModal(context: CommandExecutionContext): Promise<void> {
    if (!context.interaction) return;

    // チャンネル名を取得
    let channelName = 'このチャンネル';
    if (context.interaction.channel && 'name' in context.interaction.channel) {
      channelName = `#${context.interaction.channel.name}`;
    }

    const modal = new ModalBuilder()
      .setCustomId('confirmation-modal')
      .setTitle('メッセージ全削除の確認');

    // 確認用のテキスト入力（ダミー - 実際には使用されない）
    const confirmationInput = new TextInputBuilder()
      .setCustomId('confirmation-text')
      .setLabel(`${channelName}内のすべてのメッセージを削除しますか？`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('この操作は取り消せません')
      .setRequired(false)
      .setValue('確認しました');

    const actionRow = new ActionRowBuilder<TextInputBuilder>()
      .addComponents(confirmationInput);

    modal.addComponents(actionRow);

    await context.interaction.showModal(modal);
  }
}