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
  public static formatEmptyList(title: string, categories?: CategoryType[], defaultCategory?: CategoryType): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`📝 ${title}`)
      .setColor(this.EMBED_COLOR)
      .setFooter({
        text: '合計: 0項目 | 最終更新: 未更新'
      })
      .setTimestamp();

    // 優先順位: defaultCategory > categories > DEFAULT_CATEGORY
    let displayCategories: CategoryType[];
    if (defaultCategory) {
      displayCategories = [defaultCategory];
    } else if (categories && categories.length > 0) {
      displayCategories = categories;
    } else {
      displayCategories = [DEFAULT_CATEGORY];
    }
    
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
  public static async formatDataList(title: string, items: ListItem[], defaultCategory?: CategoryType): Promise<EmbedBuilder> {
    const template = await this.templateManager.loadTemplate('list');
    const variables = this.buildTemplateVariables(title, items, defaultCategory);
    const renderedContent = this.templateManager.renderTemplate(template, variables);
    return this.buildEmbedFromTemplate(renderedContent);
  }

  /**
   * アイテムをカテゴリー別にグルーピング
   */
  private static groupItemsByCategory(items: ListItem[], defaultCategory?: CategoryType): Record<CategoryType, ListItem[]> {
    const grouped: Record<CategoryType, ListItem[]> = {};
    
    items.forEach(item => {
      const category = item.category || defaultCategory || DEFAULT_CATEGORY;
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
      const itemText = `• ${item.name}\n`;
      
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
  private static getLatestUpdateTime(_items: ListItem[]): string {
    // 現在の時刻を返す
    return new Date().toLocaleString('ja-JP', {
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
  private static buildTemplateVariables(title: string, items: ListItem[], defaultCategory?: CategoryType): Record<string, string> {
    const categorizedItems = this.groupItemsByCategory(items, defaultCategory);
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
  public static formatToDiscordEmbed(items: ListItem[], defaultCategory?: CategoryType): {
    title: string;
    fields: Array<{ name: string; value: string }>;
  } {
    const fields = items.map(item => ({
      name: item.name,
      value: this.formatItemValue(item, defaultCategory)
    }));

    return {
      title: 'リスト',
      fields
    };
  }

  /**
   * アイテムの詳細情報をフォーマット
   */
  private static formatItemValue(item: ListItem, defaultCategory?: CategoryType): string {
    const category = `📂 カテゴリ: ${item.category || defaultCategory || DEFAULT_CATEGORY}`;
    const until = item.until ? `⏰ 期限: ${this.formatDate(item.until)}` : '';
    
    return until ? `${category}\n${until}` : category;
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