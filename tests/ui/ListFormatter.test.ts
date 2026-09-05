import { describe, it, expect } from 'vitest';
import { ComponentType } from 'discord.js';
import { ListFormatter } from '../../src/ui/ListFormatter';
import { ListItem } from '../../src/models/ListItem';

describe('ListFormatter', () => {
  describe('formatToDiscordEmbed', () => {
    it('should format single item to Discord embed', () => {
      const items: ListItem[] = [
        {
          name: 'Test Item',
          category: '重要',
          until: null,
          check: false
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('fields');
      expect(result.fields).toHaveLength(1);
      expect(result.fields[0].name).toBe('Test Item');
      expect(result.fields[0].value).toContain('📂 カテゴリ: 重要');
    });

    it('should format multiple items to Discord embed', () => {
      const items: ListItem[] = [
        {
          name: 'Item 1',
          category: '重要',
          until: null,
          check: false
        },
        {
          name: 'Item 2',
          category: '通常',
          until: new Date('2024-01-10'),
          check: false
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].name).toBe('Item 1');
      expect(result.fields[1].name).toBe('Item 2');
      expect(result.fields[1].value).toContain('⏰ 期限:');
    });

    it('should display strikethrough for completed items (check=true)', () => {
      const items: ListItem[] = [
        {
          name: 'Completed Item',
          category: '重要',
          until: null,
          check: true
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].name).toBe('~~Completed Item~~');
    });

    it('should display strikethrough including deadline for completed items with until date', () => {
      const items: ListItem[] = [
        {
          name: 'Completed Task',
          category: '重要',
          until: new Date('2024-01-15'),
          check: true
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].name).toBe('~~Completed Task (期限: 2024/1/15)~~');
    });

    it('should display normal text for incomplete items (check=false)', () => {
      const items: ListItem[] = [
        {
          name: 'Incomplete Item',
          category: '重要',
          until: null,
          check: false
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].name).toBe('Incomplete Item');
    });

    it('should handle mixed completed and incomplete items', () => {
      const items: ListItem[] = [
        {
          name: 'Complete Task',
          category: '重要',
          until: null,
          check: true
        },
        {
          name: 'Incomplete Task',
          category: '通常',
          until: null,
          check: false
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].name).toBe('~~Complete Task~~');
      expect(result.fields[1].name).toBe('Incomplete Task');
    });

    it('should handle empty list', () => {
      const items: ListItem[] = [];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result).toHaveProperty('title');
      expect(result.fields).toHaveLength(0);
    });

    it('should include category in field value', () => {
      const items: ListItem[] = [
        {
          name: 'Tech Item',
          category: '通常',
          until: null,
          check: false
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].value).toContain('通常');
    });

    it('should include date in field value', () => {
      const items: ListItem[] = [
        {
          name: 'Test Item',
          category: '重要',
          until: null,
          check: false
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].value).toContain('📂 カテゴリ: 重要');
    });
  });

  describe('formatEmptyList', () => {
    it('should use defaultCategory parameter when provided', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const defaultCategory = '食料品';

      const result = await ListFormatter.formatEmptyList(title, channelId, undefined, defaultCategory);

      expect(result.data.description).toContain('テストリスト');
      expect(result.data.description).toContain('🍎 食料品');
      expect(result.data.description).toContain('まだアイテムがありません');
    });

    it('should prioritize defaultCategory over categories array', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const categories = ['重要', '通常'];
      const defaultCategory = '食料品';

      const result = await ListFormatter.formatEmptyList(title, channelId, categories, defaultCategory);

      expect(result.data.description).toContain('🍎 食料品');
      expect(result.data.description).not.toContain('🔥 重要');
    });

    it('should use categories when defaultCategory is not provided', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const categories = ['重要', '通常'];

      const result = await ListFormatter.formatEmptyList(title, channelId, categories);

      expect(result.data.description).toContain('🔥 重要');
      expect(result.data.description).toContain('📝 通常');
    });

    it('should use DEFAULT_CATEGORY when neither defaultCategory nor categories are provided', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';

      const result = await ListFormatter.formatEmptyList(title, channelId);

      expect(result.data.description).toContain('📦 その他');
    });

    it('should render without spreadsheet links', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const categories = ['重要'];

      const result = await ListFormatter.formatEmptyList(title, channelId, categories);

      expect(result.data.description).not.toContain('スプレッドシート');
      expect(result.data.description).not.toContain('{spreadsheet_url}');
    });
  });

  describe('formatCategoryItems', () => {
    // private method testing through formatDataList
    it('should format completed items with strikethrough', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const items: ListItem[] = [
        {
          name: '完了済みアイテム',
          category: '重要',
          until: null,
          check: true
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      // formatCategoryItems should apply strikethrough for check=true
      expect(result.data.description).toContain('~~完了済みアイテム~~');
    });

    it('should format incomplete items without strikethrough', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const items: ListItem[] = [
        {
          name: '未完了アイテム',
          category: '重要',
          until: null,
          check: false
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      // formatCategoryItems should not apply strikethrough for check=false
      expect(result.data.description).toContain('• 未完了アイテム');
      expect(result.data.description).not.toContain('~~未完了アイテム~~');
    });

    it('should handle mixed completion status with deadlines', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const items: ListItem[] = [
        {
          name: '完了済み期限付き',
          category: '重要',
          until: new Date('2024-01-15'),
          check: true
        },
        {
          name: '未完了期限付き',
          category: '重要',
          until: new Date('2024-01-20'),
          check: false
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      // Completed item should have strikethrough including deadline
      expect(result.data.description).toContain('~~完了済み期限付き (期限: 1/15)~~');
      
      // Incomplete item should not have strikethrough
      expect(result.data.description).toContain('• 未完了期限付き');
      expect(result.data.description).toContain('期限: 1/20');
      expect(result.data.description).not.toContain('~~未完了期限付き~~');
    });
  });

  describe('formatDataList', () => {
    it('should use defaultCategory for items with null category', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const defaultCategory = '食料品';
      const items: ListItem[] = [
        {
          name: 'テストアイテム',  
          category: null,
          until: null,
          check: false
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId, defaultCategory);

      expect(result.data.description).toContain('🍎 食料品');
      expect(result.data.description).toContain('テストアイテム');
      expect(result.data.description).not.toContain('📦 その他');
    });

    it('should use item category when specified, ignoring defaultCategory', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const defaultCategory = '食料品';
      const items: ListItem[] = [
        {
          name: 'テストアイテム',
          category: '重要',
          until: null,
          check: false
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId, defaultCategory);

      expect(result.data.description).toContain('🔥 重要');
      expect(result.data.description).toContain('テストアイテム');
      expect(result.data.description).not.toContain('🍎 食料品');
    });

    it('should use DEFAULT_CATEGORY when neither item category nor defaultCategory is provided', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const items: ListItem[] = [
        {
          name: 'テストアイテム',
          category: null,
          until: null,
          check: false
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      expect(result.data.description).toContain('📦 その他');
      expect(result.data.description).toContain('テストアイテム');
    });

    it('should display strikethrough for completed items in category items', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const items: ListItem[] = [
        {
          name: '完了済みアイテム',
          category: '重要',
          until: null,
          check: true
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      expect(result.data.description).toContain('~~完了済みアイテム~~');
    });

    it('should display normal text for incomplete items in category items', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const items: ListItem[] = [
        {
          name: '未完了アイテム',
          category: '重要',
          until: null,
          check: false
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      expect(result.data.description).toContain('• 未完了アイテム');
      expect(result.data.description).not.toContain('~~未完了アイテム~~');
    });

    it('should handle mixed completed and incomplete items in same category', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const items: ListItem[] = [
        {
          name: '完了済みタスク',
          category: '重要',
          until: null,
          check: true
        },
        {
          name: '未完了タスク',
          category: '重要',
          until: null,
          check: false
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      expect(result.data.description).toContain('~~完了済みタスク~~');
      expect(result.data.description).toContain('• 未完了タスク');
      expect(result.data.description).not.toContain('~~未完了タスク~~');
    });

    it('should handle all completed items', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id'; 
      const items: ListItem[] = [
        {
          name: 'タスク1',
          category: '重要',
          until: null,
          check: true
        },
        {
          name: 'タスク2',
          category: '通常',
          until: null,
          check: true
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      expect(result.data.description).toContain('~~タスク1~~');
      expect(result.data.description).toContain('~~タスク2~~');
    });

    it('should handle all incomplete items', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const items: ListItem[] = [
        {
          name: 'タスク1',
          category: '重要',
          until: null,
          check: false
        },
        {
          name: 'タスク2',
          category: '通常',
          until: null,
          check: false
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      expect(result.data.description).toContain('• タスク1');
      expect(result.data.description).toContain('• タスク2');
      expect(result.data.description).not.toContain('~~タスク1~~');
      expect(result.data.description).not.toContain('~~タスク2~~');
    });

    it('should render without spreadsheet links', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const items: ListItem[] = [
        {
          name: 'テストアイテム',
          category: '重要',
          until: null,
          check: false
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      expect(result.data.description).not.toContain('スプレッドシート');
      expect(result.data.description).not.toContain('{spreadsheet_url}');
    });
  });

  describe('buildListComponents', () => {
    it('should wrap content in container text display component', () => {
      const components = ListFormatter.buildListComponents('テストコンテンツ');

      expect(components[0].type).toBe(ComponentType.Container);
      const container = components[0] as any;
      expect(container.components[0]).toEqual({
        type: ComponentType.TextDisplay,
        content: 'テストコンテンツ'
      });
    });
  });
});
it('任意カテゴリ名を安全にグループ化する', async () => {
  const content = await ListFormatter.formatDataListContent('一覧', [{name:'牛乳',category:'__proto__',until:null,check:false},{name:'パン',category:'constructor',until:null,check:false}], '1');
  expect(content).toContain('牛乳');expect(content).toContain('パン');
});
