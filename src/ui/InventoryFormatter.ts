import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { InventoryItem } from '../models/InventoryItem';

export class InventoryFormatter {
  private static readonly DEFAULT_CATEGORY = 'その他';
  private static readonly EMBED_COLOR = 0x4CAF50;

  public static formatInventoryMessage(
    items: InventoryItem[],
    title: string
  ): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
    const embed = items.length === 0
      ? this.buildEmptyEmbed(title)
      : this.buildInventoryEmbed(items, title);

    return {
      embeds: [embed],
      components: [this.buildActionRow()]
    };
  }

  private static buildEmptyEmbed(title: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription('まだ在庫アイテムがありません。')
      .setColor(this.EMBED_COLOR);
  }

  private static buildInventoryEmbed(items: InventoryItem[], title: string): EmbedBuilder {
    const groupedItems = this.groupItemsByCategory(items);
    const categories = Object.keys(groupedItems);
    const embed = new EmbedBuilder().setColor(this.EMBED_COLOR);

    if (categories.length === 1) {
      const category = categories[0];
      embed
        .setTitle(`${title} - ${category}`)
        .setDescription(this.formatItems(groupedItems[category]));
      return embed;
    }

    embed.setTitle(title);
    for (const category of categories) {
      embed.addFields({
        name: category,
        value: this.formatItems(groupedItems[category]),
        inline: false
      });
    }

    return embed;
  }

  private static groupItemsByCategory(items: InventoryItem[]): Record<string, InventoryItem[]> {
    const grouped: Record<string, InventoryItem[]> = {};

    for (const item of items) {
      const category = item.category?.trim() || this.DEFAULT_CATEGORY;
      grouped[category] ??= [];
      grouped[category].push(item);
    }

    return grouped;
  }

  private static formatItems(items: InventoryItem[]): string {
    return items
      .map((item) => `• ${item.name}: ${item.stock}`)
      .join('\n');
  }

  private static buildActionRow(): ActionRowBuilder<ButtonBuilder> {
    const addButton = new ButtonBuilder()
      .setCustomId('inventory_add')
      .setLabel('追加')
      .setStyle(ButtonStyle.Primary);

    const updateButton = new ButtonBuilder()
      .setCustomId('inventory_update')
      .setLabel('更新')
      .setStyle(ButtonStyle.Secondary);

    const deleteButton = new ButtonBuilder()
      .setCustomId('inventory_delete')
      .setLabel('削除')
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder<ButtonBuilder>()
      .addComponents(addButton, updateButton, deleteButton);
  }
}
