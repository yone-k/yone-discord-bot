import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

export class AddListCommand extends BaseCommand {
  static getCommandName(): string {
    return 'add-list';
  }

  static getCommandDescription(): string {
    return 'リストに新しい項目を追加します';
  }

  constructor(logger: Logger) {
    super('add-list', 'リストに新しい項目を追加します', logger);
    this.useThread = false;
    this.ephemeral = true;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new Error('このコマンドはDiscordインタラクションが必要です');
    }

    if (!context.channelId) {
      throw new Error('チャンネルIDが取得できません');
    }

    this.logger.info('Showing add-list modal', {
      channelId: context.channelId,
      userId: context.userId
    });

    await this.showAddListModal(context);
  }

  private async showAddListModal(context: CommandExecutionContext): Promise<void> {
    if (!context.interaction) return;

    const modal = new ModalBuilder()
      .setCustomId('add-list-modal')
      .setTitle('リストに項目を追加');

    // カテゴリーフィールド（省略可）
    const categoryInput = new TextInputBuilder()
      .setCustomId('category')
      .setLabel('カテゴリー（省略可）')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('例: 食品、日用品、その他')
      .setRequired(false)
      .setMaxLength(50);

    // アイテムフィールド（必須）
    const itemsInput = new TextInputBuilder()
      .setCustomId('items')
      .setLabel('名前,期限（1行に1つずつ記入）')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('例:\n牛乳,2024-12-31\nパン\nシャンプー,2024-06-30')
      .setRequired(true)
      .setMaxLength(4000);

    const categoryRow = new ActionRowBuilder<TextInputBuilder>()
      .addComponents(categoryInput);

    const itemsRow = new ActionRowBuilder<TextInputBuilder>()
      .addComponents(itemsInput);

    modal.addComponents(categoryRow, itemsRow);

    await context.interaction.showModal(modal);
  }
}