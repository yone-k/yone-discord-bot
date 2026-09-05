import { formatDecimal } from '../utils/Decimal';
import { ButtonStyle, ComponentType } from 'discord.js';
import type {
  APIActionRowComponent,
  APIButtonComponentWithCustomId,
  APIComponentInContainer,
  APIComponentInMessageActionRow,
  APIMessageTopLevelComponent,
  APIStringSelectComponent,
  APITextDisplayComponent
} from 'discord.js';
import type { InventoryItem } from '../models/InventoryItem';
import { DEFAULT_CATEGORY, getCategoryEmoji } from '../models/CategoryType';
import { TemplateManager } from '../services/TemplateManager';
import { LoggerManager } from '../utils/LoggerManager';

export class InventoryFormatter {
  private static readonly selectionPageSize = 25;
  private static templateManager = new TemplateManager();
  private static logger = LoggerManager.getLogger('InventoryFormatter');

  public static async formatEmptyContent(
    title: string,
    channelId: string,
    defaultCategory?: string
  ): Promise<string> {
    const category = defaultCategory || DEFAULT_CATEGORY;
    const emoji = getCategoryEmoji(category);
    const categorySections = `### ${emoji} ${category}\nまだアイテムがありません`;

    const template = await this.templateManager.loadTemplate('inventory');
    return this.templateManager.renderTemplate(template, {
      list_title: title,
      category_sections: categorySections,
      total_count: '0',
      last_update: '未更新'
    });
  }

  public static async formatDataContent(
    items: InventoryItem[],
    title: string,
    channelId: string,
    defaultCategory?: string
  ): Promise<string> {
    const template = await this.templateManager.loadTemplate('inventory');
    return this.templateManager.renderTemplate(template, {
      list_title: title,
      category_sections: this.buildCategorySections(items, defaultCategory),
      total_count: items.length.toString(),
      last_update: this.getLatestUpdateTime()
    });
  }

  public static buildInventoryComponents(content: string): APIMessageTopLevelComponent[] {
    const containerComponents: APIComponentInContainer[] = [
      this.buildTextDisplay(content),
      this.buildActionRow()
    ];

    return [{
      type: ComponentType.Container,
      components: containerComponents
    }];
  }

  public static buildInventorySelectionComponents(
    content: string,
    items: InventoryItem[],
    mode: 'update' | 'delete',
    page: number = 0
  ): APIMessageTopLevelComponent[] {
    const containerComponents: APIComponentInContainer[] = [
      this.buildTextDisplay(content)
    ];

    if (items.length > 0) {
      const currentPage = this.clampSelectionPage(items.length, page);
      containerComponents.push(this.buildSelectionActionRow(items, mode, currentPage));

      if (items.length > this.selectionPageSize) {
        containerComponents.push(this.buildSelectionPaginationActionRow(items.length, mode, currentPage));
      }
    }

    containerComponents.push(this.buildSelectionCancelActionRow());

    return [{
      type: ComponentType.Container,
      components: containerComponents
    }];
  }

  private static buildTextDisplay(content: string): APITextDisplayComponent {
    return {
      type: ComponentType.TextDisplay,
      content
    };
  }

  private static buildActionRow(): APIActionRowComponent<APIComponentInMessageActionRow> {
    const buttons: APIButtonComponentWithCustomId[] = [
      {
        type: ComponentType.Button,
        custom_id: 'inventory_add',
        label: '追加',
        style: ButtonStyle.Success
      },
      {
        type: ComponentType.Button,
        custom_id: 'inventory_update',
        label: '更新',
        style: ButtonStyle.Primary
      },
      {
        type: ComponentType.Button,
        custom_id: 'inventory_delete',
        label: '削除',
        style: ButtonStyle.Danger
      }
    ];

    return {
      type: ComponentType.ActionRow,
      components: buttons
    };
  }

  private static buildSelectionActionRow(
    items: InventoryItem[],
    mode: 'update' | 'delete',
    currentPage: number
  ): APIActionRowComponent<APIComponentInMessageActionRow> {
    const pageItems = items.slice(
      currentPage * this.selectionPageSize,
      (currentPage + 1) * this.selectionPageSize
    );

    const selectMenu: APIStringSelectComponent = {
      type: ComponentType.StringSelect,
      custom_id: `inventory_${mode}_select_${currentPage}`,
      placeholder: mode === 'update' ? '更新する在庫を選択してください' : '削除する在庫を選択してください',
      min_values: 1,
      max_values: 1,
      options: pageItems.map((item) => ({
        label: item.name,
        value: item.id,
        description: `${item.category || 'その他'} / 在庫: ${formatDecimal(item.stock)}`
      }))
    };

    return {
      type: ComponentType.ActionRow,
      components: [selectMenu]
    };
  }

  private static buildSelectionPaginationActionRow(
    itemCount: number,
    mode: 'update' | 'delete',
    currentPage: number
  ): APIActionRowComponent<APIComponentInMessageActionRow> {
    const totalPages = Math.ceil(itemCount / this.selectionPageSize);
    const buttons: APIButtonComponentWithCustomId[] = [];

    if (currentPage > 0) {
      buttons.push({
        type: ComponentType.Button,
        custom_id: `inventory_${mode}?page=${currentPage - 1}`,
        label: '前へ',
        style: ButtonStyle.Secondary
      });
    }

    if (currentPage < totalPages - 1) {
      buttons.push({
        type: ComponentType.Button,
        custom_id: `inventory_${mode}?page=${currentPage + 1}`,
        label: '次へ',
        style: ButtonStyle.Secondary
      });
    }

    return {
      type: ComponentType.ActionRow,
      components: buttons
    };
  }

  private static buildSelectionCancelActionRow(): APIActionRowComponent<APIComponentInMessageActionRow> {
    return {
      type: ComponentType.ActionRow,
      components: [{
        type: ComponentType.Button,
        custom_id: 'inventory_selection_cancel',
        label: 'キャンセル',
        style: ButtonStyle.Secondary
      }]
    };
  }

  private static clampSelectionPage(itemCount: number, page: number): number {
    const totalPages = Math.ceil(itemCount / this.selectionPageSize);
    const maxPage = Math.max(totalPages - 1, 0);

    if (!Number.isInteger(page) || page < 0) {
      return 0;
    }

    return Math.min(page, maxPage);
  }

  private static buildCategorySections(items: InventoryItem[], defaultCategory?: string): string {
    const groupedItems = this.groupItemsByCategory(items, defaultCategory);
    const sortedCategories = Object.keys(groupedItems).sort((a, b) => {
      if (a === DEFAULT_CATEGORY) return 1;
      if (b === DEFAULT_CATEGORY) return -1;
      return a.localeCompare(b, 'ja');
    });

    return sortedCategories
      .map((category) => {
        const emoji = getCategoryEmoji(category);
        const formattedItems = groupedItems[category]
          .map((item) => `• ${item.name}: ${formatDecimal(item.stock)}`)
          .join('\n');

        return `### ${emoji} ${category}\n${formattedItems}`;
      })
      .join('\n\n');
  }

  private static groupItemsByCategory(items: InventoryItem[], defaultCategory?: string): Record<string, InventoryItem[]> {
    const grouped: Record<string, InventoryItem[]> = {};

    for (const item of items) {
      const category = item.category?.trim() || defaultCategory || DEFAULT_CATEGORY;
      grouped[category] ??= [];
      grouped[category].push(item);
    }

    return grouped;
  }

  private static getLatestUpdateTime(): string {
    return new Date().toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

}
