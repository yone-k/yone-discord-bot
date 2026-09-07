import { ActionRowBuilder, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import type { InventoryItem } from '../models/InventoryItem';
import { InventoryRepository } from '../services/InventoryRepository';
import { formatInventoryEditCsv } from '../utils/InventoryParser';
import { Logger } from '../utils/logger';
import { InventoryEditSession } from '../utils/InventoryEditSession';
import { InventoryChannelStore } from '../services/InventoryChannelStore';
import { DEFAULT_CATEGORY } from '../models/CategoryType';

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
    repository: InventoryRepositoryPort = new InventoryRepository(),
    private readonly metadataReader: Pick<InventoryChannelStore, 'getChannelMetadata'> = InventoryChannelStore.getInstance()
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

    const [items, defaultCategory] = await Promise.all([
      this.repository.fetchAll(context.channelId),
      this.getDefaultCategory(context.channelId)
    ]);
    const csv=formatInventoryEditCsv(items, defaultCategory);
    if(csv.length>4000) throw new Error('編集できる文字数の上限4000文字を超えています');
    const token=InventoryEditSession.shared.open(context.channelId,context.interaction.user.id,items);
    await context.interaction.showModal(this.buildModal(csv,token));
  }

  private async getDefaultCategory(channelId: string): Promise<string> {
    try {
      const metadata = await this.metadataReader.getChannelMetadata(channelId);
      if (metadata) return metadata.defaultCategory?.trim() || DEFAULT_CATEGORY;
      this.logger.warn('在庫編集のカテゴリ設定が見つかりません', { channelId });
    } catch {
      this.logger.warn('在庫編集のカテゴリ設定を取得できません', { channelId });
    }
    return DEFAULT_CATEGORY;
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
