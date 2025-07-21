import { describe, it, expect } from 'vitest';
import { ListFormatter } from '../../src/ui/ListFormatter';
import { ListItem } from '../../src/models/ListItem';
import { CategoryType } from '../../src/models/CategoryType';

describe('ListFormatter', () => {
  describe('formatToDiscordEmbed', () => {
    it('should format single item to Discord embed', () => {
      const items: ListItem[] = [
        {
          name: 'Test Item',
          quantity: '5',
          category: '重要',
          addedAt: new Date('2024-01-01'),
          until: null
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('fields');
      expect(result.fields).toHaveLength(1);
      expect(result.fields[0].name).toBe('Test Item');
      expect(result.fields[0].value).toContain('📦 数量: 5');
      expect(result.fields[0].value).toContain('📂 カテゴリ: 重要');
    });

    it('should format multiple items to Discord embed', () => {
      const items: ListItem[] = [
        {
          name: 'Item 1',
          quantity: '3',
          category: '重要',
          addedAt: new Date('2024-01-01'),
          until: null
        },
        {
          name: 'Item 2',
          quantity: '7',
          category: '通常',
          addedAt: new Date('2024-01-02'),
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
          quantity: '2',
          category: '通常',
          addedAt: new Date('2024-01-01'),
          until: null
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].value).toContain('通常');
    });

    it('should include quantity and date in field value', () => {
      const testDate = new Date('2024-01-01');
      const items: ListItem[] = [
        {
          name: 'Test Item',
          quantity: '10',
          category: '重要',
          addedAt: testDate,
          until: null
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].value).toContain('📦 数量: 10');
      expect(result.fields[0].value).toContain('📅 追加日: 2024/1/1');
    });

    it('should handle null addedAt', () => {
      const items: ListItem[] = [
        {
          name: 'Test Item',
          quantity: '10',
          category: '重要',
          addedAt: null,
          until: null
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].value).toContain('📦 数量: 10');
      expect(result.fields[0].value).toContain('📅 追加日: 未設定');
    });
  });
});