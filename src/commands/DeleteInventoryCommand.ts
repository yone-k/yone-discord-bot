import { ActionRowBuilder, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import type { InventoryItem } from '../models/InventoryItem';
import { InventoryRepository } from '../services/InventoryRepository';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { Logger } from '../utils/logger';

interface InventoryRepositoryPort {
  findByName(channelId: string, name: string): Promise<InventoryItem | null>;
}

export class DeleteInventoryCommand extends BaseCommand {
  static getCommandName(): string {
    return 'delete-inventory';
  }

  static getCommandDescription(): string {
    return '在庫を削除する';
  }

  static getOptions(builder: SlashCommandBuilder): SlashCommandBuilder {
    return builder.addStringOption(option =>
      option
        .setName('name')
        .setDescription('削除する在庫名')
        .setRequired(true)
        .setAutocomplete(true)
    ) as SlashCommandBuilder;
  }

  private readonly repository: InventoryRepositoryPort;

  constructor(
    logger: Logger,
    repository: InventoryRepositoryPort = new InventoryRepository()
  ) {
    super('delete-inventory', '在庫を削除する', logger);
    this.useThread = false;
    this.ephemeral = true;
    this.repository = repository;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'delete-inventory',
        'Interaction is required',
        'インタラクションが必要です。'
      );
    }

    if (!context.channelId) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'delete-inventory',
        'Channel ID is required',
        'チャンネルIDが必要です。'
      );
    }

    const name = context.interaction.options.getString('name', true);
    const item = await this.repository.findByName(context.channelId, name);

    if (!item) {
      await context.interaction.reply({
        content: `在庫「${name}」が見つかりません。`,
        flags: ['Ephemeral']
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`inventory_delete_modal_${item.id}`)
      .setTitle('在庫削除の確認');

    const confirmInput = new TextInputBuilder()
      .setCustomId('confirm')
      .setLabel('削除する場合は YES と入力してください')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput)
    );

    await context.interaction.showModal(modal);
  }
}
