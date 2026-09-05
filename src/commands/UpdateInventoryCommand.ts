import { ActionRowBuilder, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import type { InventoryItem } from '../models/InventoryItem';
import { InventoryRepository } from '../services/InventoryRepository';
import { formatInventoryEditCsv } from '../utils/InventoryParser';
import { Logger } from '../utils/logger';
import { InventoryEditSession } from '../utils/InventoryEditSession';

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
    const csv=formatInventoryEditCsv(items);
    if(csv.length>4000) throw new Error('編集できる文字数の上限4000文字を超えています');
    const token=InventoryEditSession.shared.open(context.channelId,context.interaction.user.id,items);
    await context.interaction.showModal(this.buildModal(csv,token));
  }

  private buildModal(csv:string,token:string): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`inventory_update_modal:${token}`)
      .setTitle('在庫を更新');

    const itemsInput = new TextInputBuilder()
      .setCustomId('items')
      .setLabel('行番号,名前,在庫数,カテゴリ（番号は変更しない）')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(4000)
      .setPlaceholder('既存の行番号はそのまま。新規行は番号を空欄にします。\n,新しい品名,3,食品')
;
    if(csv) itemsInput.setValue(csv);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(itemsInput)
    );

    return modal;
  }
}
