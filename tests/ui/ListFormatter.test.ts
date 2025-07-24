import { describe, it, expect } from 'vitest';
import { ListFormatter } from '../../src/ui/ListFormatter';
import { ListItem } from '../../src/models/ListItem';

describe('ListFormatter', () => {
  describe('formatToDiscordEmbed', () => {
    it('should format single item to Discord embed', () => {
      const items: ListItem[] = [
        {
          name: 'Test Item',
          category: '重要',
          until: null
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
          until: null
        },
        {
          name: 'Item 2',
          category: '通常',
          until: new Date('2024-01-10')
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].name).toBe('Item 1');
      expect(result.fields[1].name).toBe('Item 2');
      expect(result.fields[1].value).toContain('⏰ 期限:');
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
          until: null
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
          until: null
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

    it('should include spreadsheet URL with gid parameter in description', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const categories = ['重要'];

      const result = await ListFormatter.formatEmptyList(title, channelId, categories);

      expect(result.data.description).toContain('[スプレッドシートを開く](https://docs.google.com/spreadsheets/d/');
      expect(result.data.description).toContain('#gid=');
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
          until: null
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
          until: null
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
          until: null
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      expect(result.data.description).toContain('📦 その他');
      expect(result.data.description).toContain('テストアイテム');
    });

    it('should include spreadsheet URL with gid parameter in description', async () => {
      const title = 'テストリスト';
      const channelId = 'test-channel-id';
      const items: ListItem[] = [
        {
          name: 'テストアイテム',
          category: '重要',
          until: null
        }
      ];

      const result = await ListFormatter.formatDataList(title, items, channelId);

      expect(result.data.description).toContain('[スプレッドシートを開く](https://docs.google.com/spreadsheets/d/');
      expect(result.data.description).toContain('#gid=');
    });
  });
});