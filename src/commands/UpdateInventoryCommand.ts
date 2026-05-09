import { ActionRowBuilder, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import type { InventoryItem } from '../models/InventoryItem';
import { InventoryRepository } from '../services/InventoryRepository';
import { formatInventoryCsvText } from '../utils/InventoryParser';
import { Logger } from '../utils/logger';

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
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
    return builder;
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

    const items = await this.repository.fetchAll(context.channelId);
    await context.interaction.showModal(this.buildModal(items));
  }

  private buildModal(items: InventoryItem[]): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId('inventory_update_modal')
      .setTitle('在庫を更新');

    const itemsInput = new TextInputBuilder()
      .setCustomId('items')
      .setLabel('在庫一覧（名前,在庫数,カテゴリ）を編集')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000)
      .setPlaceholder('例: 洗剤,3,日用品\n米,10,食品')
      .setValue(formatInventoryCsvText(items));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(itemsInput)
    );

    return modal;
  }
}
