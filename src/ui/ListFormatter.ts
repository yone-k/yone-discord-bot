import { EmbedBuilder } from 'discord.js';
import { ListItem } from '../models/ListItem';
import { CategoryType, getCategoryEmoji, DEFAULT_CATEGORY } from '../models/CategoryType';
import { TemplateManager } from '../services/TemplateManager';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

export class ListFormatter {
  private static readonly MAX_FIELD_LENGTH = 800;
  private static readonly EMBED_COLOR = 0x4CAF50; // 緑色
  private static templateManager = new TemplateManager();

  /**
   * 空リスト用のEmbedを生成
   */
  public static async formatEmptyList(title: string, channelId: string, categories?: CategoryType[], defaultCategory?: CategoryType): Promise<EmbedBuilder> {
    // 優先順位: defaultCategory > categories > DEFAULT_CATEGORY
    let displayCategories: CategoryType[];
    if (defaultCategory) {
      displayCategories = [defaultCategory];
    } else if (categories && categories.length > 0) {
      displayCategories = categories;
    } else {
      displayCategories = [DEFAULT_CATEGORY];
    }
    
    // 空リスト用のカテゴリセクションを生成
    const categorySections = displayCategories.map(category => {
      const emoji = getCategoryEmoji(category);
      return `## ${emoji} ${category}\nまだアイテムがありません`;
    }).join('\n\n');

    const template = await this.templateManager.loadTemplate('list');
    const variables = {
      list_title: title,
      category_sections: categorySections,
      total_count: '0',
      last_update: '未更新',
      spreadsheet_url: await this.getSpreadsheetUrl(channelId)
    };
    const renderedContent = this.templateManager.renderTemplate(template, variables);
    return this.buildEmbedFromTemplate(renderedContent);
  }

  /**
   * データありリスト用のEmbedを生成
   */
  public static async formatDataList(title: string, items: ListItem[], channelId: string, defaultCategory?: CategoryType): Promise<EmbedBuilder> {
    const template = await this.templateManager.loadTemplate('list');
    const variables = await this.buildTemplateVariables(title, items, channelId, defaultCategory);
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
  private static async buildTemplateVariables(title: string, items: ListItem[], channelId: string, defaultCategory?: CategoryType): Promise<Record<string, string>> {
    const categorizedItems = this.groupItemsByCategory(items, defaultCategory);
    const categorySections = this.buildCategorySections(categorizedItems);
    const spreadsheetUrl = await this.getSpreadsheetUrl(channelId);
    
    return {
      list_title: title,
      category_sections: categorySections,
      total_count: items.length.toString(),
      last_update: this.getLatestUpdateTime(items),
      spreadsheet_url: spreadsheetUrl
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
    const embed = new EmbedBuilder()
      .setDescription(renderedContent)
      .setColor(this.EMBED_COLOR)
      .setTimestamp();

    return embed;
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

  /**
   * スプレッドシートURLを取得します
   * 
   * @param {string} channelId チャンネルID（特定のシートを開くため）
   * @return {Promise<string>} スプレッドシートのURL。取得できない場合は空文字列またはテスト用URL
   */
  private static async getSpreadsheetUrl(channelId: string): Promise<string> {
    try {
      const googleSheetsService = GoogleSheetsService.getInstance();
      // NOTE: configへの直接アクセスは一時的な措置。将来的にはpublicなgetterメソッドの追加を検討
      const spreadsheetId = (googleSheetsService as unknown as { config?: { spreadsheetId: string } }).config?.spreadsheetId;
      
      if (spreadsheetId) {
        try {
          // 特定のシートのメタデータを取得してシートIDを取得
          const sheetMetadata = await googleSheetsService.getSheetMetadata(channelId);
          return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetMetadata.sheetId}`;
        } catch (sheetError) {
          // シートが存在しない場合は通常のスプレッドシートURLを返す
          console.warn('Failed to get sheet metadata, falling back to main spreadsheet URL:', sheetError);
          return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // テスト環境またはConfigエラーの場合は、ダミーURLを返す
      if (process.env.NODE_ENV === 'test' || errorMessage.includes('Missing required environment variables')) {
        return 'https://docs.google.com/spreadsheets/d/test-spreadsheet-id/edit#gid=0';
      }
      
      // その他のエラーが発生した場合はログを出力
      console.warn('Failed to get spreadsheet URL:', errorMessage);
    }
    
    return '';
  }
}