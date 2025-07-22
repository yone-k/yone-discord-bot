import { EmbedBuilder } from 'discord.js';
import { ListItem } from '../models/ListItem';
import { CategoryType, getCategoryEmoji, DEFAULT_CATEGORY } from '../models/CategoryType';
import { TemplateManager } from '../services/TemplateManager';

export class ListFormatter {
  private static readonly MAX_FIELD_LENGTH = 800;
  private static readonly EMBED_COLOR = 0x4CAF50; // 緑色
  private static templateManager = new TemplateManager();

  /**
   * 空リスト用のEmbedを生成
   */
  public static formatEmptyList(title: string, categories?: CategoryType[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`📝 ${title}`)
      .setColor(this.EMBED_COLOR)
      .setFooter({
        text: '合計: 0項目 | 最終更新: 未更新'
      })
      .setTimestamp();

    // カテゴリが指定されていない場合はデフォルトカテゴリを表示
    const displayCategories = categories && categories.length > 0 ? categories : [DEFAULT_CATEGORY];
    
    displayCategories.forEach(category => {
      embed.addFields({
        name: `${getCategoryEmoji(category)} ${category}`,
        value: 'まだアイテムがありません',
        inline: true
      });
    });

    return embed;
  }

  /**
   * データありリスト用のEmbedを生成
   */
  public static async formatDataList(title: string, items: ListItem[]): Promise<EmbedBuilder> {
    const template = await this.templateManager.loadTemplate('list');
    const variables = this.buildTemplateVariables(title, items);
    const renderedContent = this.templateManager.renderTemplate(template, variables);
    return this.buildEmbedFromTemplate(renderedContent);
  }

  /**
   * アイテムをカテゴリー別にグルーピング
   */
  private static groupItemsByCategory(items: ListItem[]): Record<CategoryType, ListItem[]> {
    const grouped: Record<CategoryType, ListItem[]> = {};
    
    items.forEach(item => {
      const category = item.category || DEFAULT_CATEGORY;
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(item);
    });
    
    return grouped;
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
      const itemText = (!item.quantity || item.quantity === '' || item.quantity.trim() === '') 
        ? `• ${item.name}\n`
        : `• ${item.name} ${item.quantity}\n`;
      
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

    // addedAtがnullではないアイテムのみをフィルタリング
    const datedItems = items.filter(item => item.addedAt !== null);
    
    if (datedItems.length === 0) {
      return '未更新';
    }

    const latestDate = datedItems.reduce((latest, item) => {
      return item.addedAt! > latest ? item.addedAt! : latest;
    }, datedItems[0].addedAt!);

    return latestDate.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * テンプレート変数を構築
   */
  private static buildTemplateVariables(title: string, items: ListItem[]): Record<string, string> {
    const categorizedItems = this.groupItemsByCategory(items);
    const categorySections = this.buildCategorySections(categorizedItems);
    
    return {
      list_title: title,
      category_sections: categorySections,
      total_count: items.length.toString(),
      last_update: this.getLatestUpdateTime(items)
    };
  }

  /**
   * カテゴリーのアイテムをテキスト形式でフォーマット
   */
  private static formatCategoryItems(items: ListItem[]): string {
    if (items.length === 0) {
      return 'アイテムなし';
    }

    return items.map(item => {
      let itemText = `• ${item.name}`;
      
      // 数量がある場合は追加
      if (item.quantity && item.quantity.trim() !== '') {
        itemText += ` ${item.quantity}`;
      }
      
      // 期限がある場合は追加
      if (item.until) {
        const untilDate = this.formatDateShort(item.until);
        itemText += ` (期限: ${untilDate})`;
      }
      
      return itemText;
    }).join('\n');
  }

  /**
   * カテゴリーセクションを構築
   */
  private static buildCategorySections(categorizedItems: Record<CategoryType, ListItem[]>): string {
    const sections: string[] = [];
    
    // カテゴリをソート（デフォルトカテゴリを最後に）
    const sortedCategories = Object.keys(categorizedItems).sort((a, b) => {
      if (a === DEFAULT_CATEGORY) return 1;
      if (b === DEFAULT_CATEGORY) return -1;
      return a.localeCompare(b, 'ja');
    });
    
    sortedCategories.forEach(category => {
      const items = categorizedItems[category];
      const emoji = getCategoryEmoji(category);
      const formattedItems = this.formatCategoryItems(items);
      
      sections.push(`## ${emoji} ${category}\n${formattedItems}`);
    });
    
    return sections.join('\n\n');
  }

  /**
   * テンプレートからEmbedBuilderを構築
   */
  private static buildEmbedFromTemplate(renderedContent: string): EmbedBuilder {
    return new EmbedBuilder()
      .setDescription(renderedContent)
      .setColor(this.EMBED_COLOR)
      .setTimestamp();
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
    const quantity = `📦 数量: ${item.quantity || '未設定'}`;
    const category = `📂 カテゴリ: ${item.category || DEFAULT_CATEGORY}`;
    const date = item.addedAt ? `📅 追加日: ${this.formatDate(item.addedAt)}` : '📅 追加日: 未設定';
    const until = item.until ? `⏰ 期限: ${this.formatDate(item.until)}` : '';
    
    return until ? `${quantity}\n${category}\n${date}\n${until}` : `${quantity}\n${category}\n${date}`;
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

  /**
   * 日付をM/D形式でフォーマット（短縮版）
   */
  private static formatDateShort(date: Date): string {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  }
}