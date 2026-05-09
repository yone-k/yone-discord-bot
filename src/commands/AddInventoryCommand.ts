import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';

export class AddInventoryCommand extends BaseCommand {
  static getCommandName(): string {
    return 'add-inventory';
  }

  static getCommandDescription(): string {
    return '在庫アイテムを追加する';
  }

  constructor(logger: Logger) {
    super('add-inventory', '在庫アイテムを追加する', logger);
    this.useThread = false;
    this.ephemeral = true;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new Error('このコマンドはDiscordインタラクションが必要です');
    }

    const modal = new ModalBuilder()
      .setCustomId('inventory_add_modal')
      .setTitle('在庫アイテムを追加');

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('名前')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const stockInput = new TextInputBuilder()
      .setCustomId('stock')
      .setLabel('在庫数')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(20);

    const categoryInput = new TextInputBuilder()
      .setCustomId('category')
      .setLabel('カテゴリー')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(50);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(stockInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput)
    );

    await context.interaction.showModal(modal);
  }
}
