import { ActionRowBuilder, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import type { InventoryItem } from '../models/InventoryItem';
import { InventoryRepository } from '../services/InventoryRepository';
import { Logger } from '../utils/logger';

interface InventoryRepositoryPort {
  findByName(channelId: string, name: string): Promise<InventoryItem | null>;
}

export class UpdateInventoryCommand extends BaseCommand {
  private readonly repository: InventoryRepositoryPort;

  static getCommandName(): string {
    return 'update-inventory';
  }

  static getCommandDescription(): string {
    return '在庫を更新する';
  }

  static getOptions(builder: SlashCommandBuilder): SlashCommandBuilder {
    return builder.addStringOption(option =>
      option
        .setName('name')
        .setDescription('更新する在庫アイテム名')
        .setRequired(true)
        .setAutocomplete(true)
    ) as SlashCommandBuilder;
  }

  constructor(
    logger: Logger,
    repository: InventoryRepositoryPort = new InventoryRepository()
  ) {
    super('update-inventory', '在庫を更新する', logger);
    this.useThread = false;
    this.ephemeral = true;
    this.repository = repository;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction || !context.channelId) {
      throw new Error('このコマンドはDiscordインタラクションとチャンネルIDが必要です');
    }

    const name = context.interaction.options.getString('name', true);
    const item = await this.repository.findByName(context.channelId, name);

    if (!item) {
      await context.interaction.reply({
        content: `アイテムが見つかりません: ${name}`,
        flags: ['Ephemeral'] as const
      });
      return;
    }

    await context.interaction.showModal(this.buildModal(item));
  }

  private buildModal(item: InventoryItem): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`inventory_update_modal_${item.id}`)
      .setTitle('在庫を更新');

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('名前')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100)
      .setValue(item.name);

    const stockInput = new TextInputBuilder()
      .setCustomId('stock')
      .setLabel('在庫数')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(20)
      .setValue(String(item.stock));

    const categoryInput = new TextInputBuilder()
      .setCustomId('category')
      .setLabel('カテゴリー')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(50)
      .setValue(item.category);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(stockInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput)
    );

    return modal;
  }
}
