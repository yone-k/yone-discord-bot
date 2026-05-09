import { describe, expect, it } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';
import { InventoryFormatter } from '../../src/ui/InventoryFormatter';
import type { InventoryItem } from '../../src/models/InventoryItem';

describe('InventoryFormatter', () => {
  describe('formatInventoryMessage', () => {
    it('Given empty items When formatting inventory message Then returns empty state embed and 3 action buttons', () => {
      // Given
      const items: InventoryItem[] = [];
      const title = '在庫リスト';

      // When
      const result = InventoryFormatter.formatInventoryMessage(items, title);

      // Then
      expect(result.embeds).toHaveLength(1);
      expect(result.embeds[0].data.title).toBe(title);
      expect(result.embeds[0].data.description).toContain('まだ在庫アイテムがありません');
      expect(result.components).toHaveLength(1);
      expect(result.components[0].components).toHaveLength(3);
    });

    it('Given items in one category When formatting inventory message Then returns one category embed with name and stock', () => {
      // Given
      const items: InventoryItem[] = [
        { id: 'item-1', name: '米', stock: 5, category: '食品' },
        { id: 'item-2', name: '水', stock: 12, category: '食品' }
      ];

      // When
      const result = InventoryFormatter.formatInventoryMessage(items, '在庫リスト');

      // Then
      expect(result.embeds).toHaveLength(1);
      expect(result.embeds[0].data.title).toContain('食品');
      expect(result.embeds[0].data.description).toContain('米');
      expect(result.embeds[0].data.description).toContain('5');
      expect(result.embeds[0].data.description).toContain('水');
      expect(result.embeds[0].data.description).toContain('12');
    });

    it('Given items in multiple categories When formatting inventory message Then separates items by category fields', () => {
      // Given
      const items: InventoryItem[] = [
        { id: 'item-1', name: '米', stock: 5, category: '食品' },
        { id: 'item-2', name: '電池', stock: 3, category: '日用品' }
      ];

      // When
      const result = InventoryFormatter.formatInventoryMessage(items, '在庫リスト');

      // Then
      expect(result.embeds).toHaveLength(1);
      expect(result.embeds[0].data.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: expect.stringContaining('食品'),
            value: expect.stringContaining('米')
          }),
          expect.objectContaining({
            name: expect.stringContaining('日用品'),
            value: expect.stringContaining('電池')
          })
        ])
      );
    });

    it('Given item with empty category When formatting inventory message Then assigns it to default category', () => {
      // Given
      const items: InventoryItem[] = [
        { id: 'item-1', name: '分類なしアイテム', stock: 1, category: '' }
      ];

      // When
      const result = InventoryFormatter.formatInventoryMessage(items, '在庫リスト');

      // Then
      const categoryNames = [
        result.embeds[0].data.title,
        ...(result.embeds[0].data.fields?.map(field => field.name) ?? [])
      ].join('\n');
      expect(categoryNames).toMatch(/その他|カテゴリなし/);
      expect(JSON.stringify(result.embeds[0].data)).toContain('分類なしアイテム');
    });

    it('Given any items When formatting inventory message Then creates add update and delete buttons', () => {
      // Given
      const items: InventoryItem[] = [
        { id: 'item-1', name: '米', stock: 5, category: '食品' }
      ];

      // When
      const result = InventoryFormatter.formatInventoryMessage(items, '在庫リスト');

      // Then
      expect(result.components).toHaveLength(1);
      expect(result.components[0].data.type).toBe(ComponentType.ActionRow);
      const buttons = result.components[0].components.map(component => component.data);
      expect(buttons).toEqual([
        expect.objectContaining({
          custom_id: 'inventory_add',
          label: '追加',
          style: ButtonStyle.Primary
        }),
        expect.objectContaining({
          custom_id: 'inventory_update',
          label: '更新',
          style: ButtonStyle.Secondary
        }),
        expect.objectContaining({
          custom_id: 'inventory_delete',
          label: '削除',
          style: ButtonStyle.Danger
        })
      ]);
    });
  });
});
