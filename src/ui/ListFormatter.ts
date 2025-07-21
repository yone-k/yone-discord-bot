import { EmbedBuilder } from 'discord.js';
import { ListItem } from '../models/ListItem';
import { CategoryType } from '../models/CategoryType';

export class ListFormatter {
  private static readonly MAX_FIELD_LENGTH = 800;
  private static readonly EMBED_COLOR = 0x4CAF50; // 緑色

  /**
   * 空リスト用のEmbedを生成
   */
  public static formatEmptyList(title: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`📝 ${title}`)
      .setColor(this.EMBED_COLOR)
      .addFields(
        {
          name: '🔥 重要',
          value: 'まだアイテムがありません',
          inline: true
        },
        {
          name: '📝 通常',
          value: 'まだアイテムがありません',
          inline: true
        },
        {
          name: '📦 その他',
          value: 'まだアイテムがありません',
          inline: true
        }
      )
      .setFooter({
        text: '合計: 0項目 | 最終更新: 未更新'
      })
      .setTimestamp();
  }

  /**
   * データありリスト用のEmbedを生成
   */
  public static formatDataList(title: string, items: ListItem[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`📝 ${title}`)
      .setColor(this.EMBED_COLOR);

    // カテゴリー別にグルーピング
    const categorizedItems = this.groupItemsByCategory(items);

    // 各カテゴリーのフィールドを追加
    this.addCategoryField(embed, '🔥 重要', categorizedItems.primary);
    this.addCategoryField(embed, '📝 通常', categorizedItems.secondary);
    this.addCategoryField(embed, '📦 その他', categorizedItems.other);

    // フッター情報を設定
    const latestUpdate = this.getLatestUpdateTime(items);
    embed.setFooter({
      text: `合計: ${items.length}項目 | 最終更新: ${latestUpdate}`
    });
    embed.setTimestamp();

    return embed;
  }

  /**
   * アイテムをカテゴリー別にグルーピング
   */
  private static groupItemsByCategory(items: ListItem[]): {
    primary: ListItem[];
    secondary: ListItem[];
    other: ListItem[];
  } {
    return {
      primary: items.filter(item => item.category === CategoryType.PRIMARY),
      secondary: items.filter(item => item.category === CategoryType.SECONDARY),
      other: items.filter(item => item.category === CategoryType.OTHER)
    };
  }

  /**
   * カテゴリーフィールドをEmbedに追加
   */
  private static addCategoryField(embed: EmbedBuilder, fieldName: string, items: ListItem[]): void {
    if (items.length === 0) {
      embed.addFields({
        name: fieldName,
        value: 'アイテムなし',
        inline: true
      });
      return;
    }

    let fieldValue = '';
    let displayedCount = 0;

    for (const item of items) {
      const itemText = `• ${item.name} (${item.quantity})\n`;
      
      // 文字数制限チェック
      if (fieldValue.length + itemText.length > this.MAX_FIELD_LENGTH) {
        const remainingCount = items.length - displayedCount;
        fieldValue += `...他${remainingCount}項目`;
        break;
      }

      fieldValue += itemText;
      displayedCount++;
    }

    // デバッグ用：空文字列チェック
    if (!fieldValue || fieldValue.trim() === '') {
      fieldValue = 'アイテムなし';
    }

    embed.addFields({
      name: fieldName,
      value: fieldValue,
      inline: true
    });
  }

  /**
   * 最新の更新時刻を取得
   */
  private static getLatestUpdateTime(items: ListItem[]): string {
    if (items.length === 0) {
      return '未更新';
    }

    const latestDate = items.reduce((latest, item) => {
      return item.addedAt > latest ? item.addedAt : latest;
    }, items[0].addedAt);

    return latestDate.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * ListItemsをDiscord Embed形式のオブジェクトに変換
   */
  public static formatToDiscordEmbed(items: ListItem[]): {
    title: string;
    fields: Array<{ name: string; value: string }>;
  } {
    const fields = items.map(item => ({
      name: item.name,
      value: this.formatItemValue(item)
    }));

    return {
      title: 'リスト',
      fields
    };
  }

  /**
   * アイテムの詳細情報をフォーマット
   */
  private static formatItemValue(item: ListItem): string {
    const quantity = `📦 数量: ${item.quantity}`;
    const category = `📂 カテゴリ: ${item.category}`;
    const date = `📅 追加日: ${this.formatDate(item.addedAt)}`;
    
    return `${quantity}\n${category}\n${date}`;
  }

  /**
   * 日付をYYYY/M/D形式でフォーマット
   */
  private static formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}/${month}/${day}`;
  }
}