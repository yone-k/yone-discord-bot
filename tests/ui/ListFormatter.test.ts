import { describe, it, expect } from 'vitest';
import { ListFormatter } from '../../src/ui/ListFormatter';
import { ListItem } from '../../src/models/ListItem';
import { CategoryType } from '../../src/models/CategoryType';

describe('ListFormatter', () => {
  describe('formatToDiscordEmbed', () => {
    it('should format single item to Discord embed', () => {
      const items: ListItem[] = [
        {
          id: '1',
          name: 'Test Item',
          quantity: 5,
          category: CategoryType.PRIMARY,
          addedAt: new Date('2024-01-01')
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('fields');
      expect(result.fields).toHaveLength(1);
      expect(result.fields[0].name).toBe('Test Item');
      expect(result.fields[0].value).toContain('📦 数量: 5');
      expect(result.fields[0].value).toContain('📂 カテゴリ: primary');
    });

    it('should format multiple items to Discord embed', () => {
      const items: ListItem[] = [
        {
          id: '1',
          name: 'Item 1',
          quantity: 3,
          category: CategoryType.PRIMARY,
          addedAt: new Date('2024-01-01')
        },
        {
          id: '2',
          name: 'Item 2',
          quantity: 7,
          category: CategoryType.SECONDARY,
          addedAt: new Date('2024-01-02')
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].name).toBe('Item 1');
      expect(result.fields[1].name).toBe('Item 2');
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
          id: '1',
          name: 'Tech Item',
          quantity: 2,
          category: CategoryType.SECONDARY,
          addedAt: new Date('2024-01-01')
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].value).toContain('secondary');
    });

    it('should include quantity and date in field value', () => {
      const testDate = new Date('2024-01-01');
      const items: ListItem[] = [
        {
          id: '1',
          name: 'Test Item',
          quantity: 10,
          category: CategoryType.PRIMARY,
          addedAt: testDate
        }
      ];

      const result = ListFormatter.formatToDiscordEmbed(items);

      expect(result.fields[0].value).toContain('📦 数量: 10');
      expect(result.fields[0].value).toContain('📅 追加日: 2024/1/1');
    });
  });
});