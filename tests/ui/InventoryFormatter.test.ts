import { describe, expect, it } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';
import { InventoryFormatter } from '../../src/ui/InventoryFormatter';
import type { InventoryItem } from '../../src/models/InventoryItem';

describe('InventoryFormatter', () => {
  const channelId = 'channel-1';

  describe('formatEmptyContent', () => {
    it('Given empty items When formatting empty content Then renders title with default empty section and total 0', async () => {
      // Given
      const title = '在庫リスト';

      // When
      const content = await InventoryFormatter.formatEmptyContent(title, channelId);

      // Then
      expect(content).toContain(`## ${title}`);
      expect(content).toContain('まだアイテムがありません');
      expect(content).toContain('合計: 0項目');
      expect(content).toContain('最終更新');
      expect(content).not.toContain('スプレッドシートを開く');
    });

    it('Given default category When formatting empty content Then includes default category section with emoji', async () => {
      // Given
      const title = '在庫リスト';
      const defaultCategory = '食料品';

      // When
      const content = await InventoryFormatter.formatEmptyContent(title, channelId, defaultCategory);

      // Then
      expect(content).toContain('### 🍎 食料品');
      expect(content).toContain('まだアイテムがありません');
    });
  });

  describe('formatDataContent', () => {
    it('Given items in a single category When formatting data content Then renders category section with name and stock per item', async () => {
      // Given
      const items: InventoryItem[] = [
        { id: 'item-1', name: '米', stock: '5', category: '食料品' },
        { id: 'item-2', name: '水', stock: '12', category: '食料品' }
      ];

      // When
      const content = await InventoryFormatter.formatDataContent(items, '在庫リスト', channelId);

      // Then
      expect(content).toContain('## 在庫リスト');
      expect(content).toContain('### 🍎 食料品');
      expect(content).toContain('• 米: 5');
      expect(content).toContain('• 水: 12');
      expect(content).toContain('合計: 2項目');
    });

    it('Given items in multiple categories When formatting data content Then renders multiple category sections', async () => {
      // Given
      const items: InventoryItem[] = [
        { id: 'item-1', name: '米', stock: '5', category: '食料品' },
        { id: 'item-2', name: '電池', stock: '3', category: '日用品' }
      ];

      // When
      const content = await InventoryFormatter.formatDataContent(items, '在庫リスト', channelId);

      // Then
      expect(content).toContain('### 🍎 食料品');
      expect(content).toContain('• 米: 5');
      expect(content).toContain('### 🧽 日用品');
      expect(content).toContain('• 電池: 3');
    });

    it('Given item with empty category When formatting data content Then assigns it to default category section', async () => {
      // Given
      const items: InventoryItem[] = [
        { id: 'item-1', name: '分類なし', stock: '1', category: '' }
      ];

      // When
      const content = await InventoryFormatter.formatDataContent(items, '在庫リスト', channelId);

      // Then
      expect(content).toContain('### 📦 その他');
      expect(content).toContain('• 分類なし: 1');
    });

    it('Given items When formatting data content Then includes update timestamp without a spreadsheet link', async () => {
      // Given
      const items: InventoryItem[] = [
        { id: 'item-1', name: '米', stock: '5', category: '食料品' }
      ];

      // When
      const content = await InventoryFormatter.formatDataContent(items, '在庫リスト', channelId);

      // Then
      expect(content).not.toContain('スプレッドシートを開く');
      expect(content).toContain('合計: 1項目');
      expect(content).toContain('最終更新');
    });
  });

  describe('buildInventoryComponents', () => {
    it('Given rendered content When building inventory components Then returns single container with text display and action row', () => {
      // Given
      const content = '## 在庫リスト\n\n本文';

      // When
      const components = InventoryFormatter.buildInventoryComponents(content);

      // Then
      expect(components).toHaveLength(1);
      const container = components[0] as { type: number; components: Array<{ type: number; content?: string }> };
      expect(container.type).toBe(ComponentType.Container);
      expect(container.components[0]).toMatchObject({
        type: ComponentType.TextDisplay,
        content
      });
      const actionRow = container.components[container.components.length - 1] as { type: number; components: Array<{ custom_id: string; label: string; style: number }> };
      expect(actionRow.type).toBe(ComponentType.ActionRow);
      expect(actionRow.components).toEqual([
        expect.objectContaining({
          custom_id: 'inventory_add',
          label: '追加',
          style: ButtonStyle.Success
        }),
        expect.objectContaining({
          custom_id: 'inventory_update',
          label: '更新',
          style: ButtonStyle.Primary
        }),
        expect.objectContaining({
          custom_id: 'inventory_delete',
          label: '削除',
          style: ButtonStyle.Danger
        })
      ]);
    });
  });

  describe('buildInventorySelectionComponents', () => {
    const createItems = (count: number): InventoryItem[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `item-${index + 1}`,
        name: `在庫${index + 1}`,
        stock: String(index + 1),
        category: index % 2 === 0 ? '日用品' : '食料品'
      }));

    const getContainerComponents = (components: unknown[]): any[] =>
      (components[0] as { components: any[] }).components;

    const findSelectMenu = (components: unknown[]): any =>
      getContainerComponents(components)
        .flatMap((component: any) => component.components ?? [])
        .find((component: any) => component.type === ComponentType.StringSelect);

    const findButtonByLabel = (components: unknown[], label: string): any =>
      getContainerComponents(components)
        .flatMap((component: any) => component.components ?? [])
        .find((component: any) => component.label === label);

    it('Given one item and update mode When building selection components Then returns update select menu without pagination and cancel button', () => {
      // Given
      const content = '## 在庫リスト';
      const items = createItems(1);

      // When
      const components = InventoryFormatter.buildInventorySelectionComponents(content, items, 'update');

      // Then
      expect(components).toHaveLength(1);
      const containerComponents = getContainerComponents(components);
      expect(components[0]).toMatchObject({ type: ComponentType.Container });
      expect(containerComponents).toHaveLength(3);
      expect(containerComponents[0]).toMatchObject({
        type: ComponentType.TextDisplay,
        content
      });
      const selectMenu = findSelectMenu(components);
      expect(selectMenu).toMatchObject({
        custom_id: 'inventory_update_select_0',
        placeholder: '更新する在庫を選択してください'
      });
      expect(selectMenu.options).toEqual([
        expect.objectContaining({
          label: '在庫1',
          value: 'item-1',
          description: '日用品 / 在庫: 1'
        })
      ]);
      expect(findButtonByLabel(components, '前へ')).toBeUndefined();
      expect(findButtonByLabel(components, '次へ')).toBeUndefined();
      expect(findButtonByLabel(components, 'キャンセル')).toMatchObject({
        custom_id: 'inventory_selection_cancel',
        style: ButtonStyle.Secondary
      });
    });

    it('Given 30 items and first page When building update selection components Then returns 25 options, next button, and cancel button', () => {
      // Given
      const items = createItems(30);

      // When
      const components = InventoryFormatter.buildInventorySelectionComponents('content', items, 'update', 0);

      // Then
      const selectMenu = findSelectMenu(components);
      expect(selectMenu.custom_id).toBe('inventory_update_select_0');
      expect(selectMenu.options).toHaveLength(25);
      expect(selectMenu.options[0]).toEqual(expect.objectContaining({ value: 'item-1' }));
      expect(selectMenu.options[24]).toEqual(expect.objectContaining({ value: 'item-25' }));
      expect(findButtonByLabel(components, '前へ')).toBeUndefined();
      expect(findButtonByLabel(components, '次へ')).toMatchObject({
        custom_id: 'inventory_update?page=1'
      });
      expect(findButtonByLabel(components, 'キャンセル')).toBeDefined();
    });

    it('Given 30 items and second page When building update selection components Then returns remaining 5 options, previous button, and cancel button', () => {
      // Given
      const items = createItems(30);

      // When
      const components = InventoryFormatter.buildInventorySelectionComponents('content', items, 'update', 1);

      // Then
      const selectMenu = findSelectMenu(components);
      expect(selectMenu.custom_id).toBe('inventory_update_select_1');
      expect(selectMenu.options).toHaveLength(5);
      expect(selectMenu.options[0]).toEqual(expect.objectContaining({ value: 'item-26' }));
      expect(selectMenu.options[4]).toEqual(expect.objectContaining({ value: 'item-30' }));
      expect(findButtonByLabel(components, '前へ')).toMatchObject({
        custom_id: 'inventory_update?page=0'
      });
      expect(findButtonByLabel(components, '次へ')).toBeUndefined();
      expect(findButtonByLabel(components, 'キャンセル')).toBeDefined();
    });

    it('Given one item and delete mode When building selection components Then returns delete select menu and delete placeholder', () => {
      // Given
      const items = createItems(1);

      // When
      const components = InventoryFormatter.buildInventorySelectionComponents('content', items, 'delete');

      // Then
      const selectMenu = findSelectMenu(components);
      expect(selectMenu).toMatchObject({
        custom_id: 'inventory_delete_select_0',
        placeholder: '削除する在庫を選択してください'
      });
      expect(selectMenu.options).toEqual([
        expect.objectContaining({
          label: '在庫1',
          value: 'item-1',
          description: '日用品 / 在庫: 1'
        })
      ]);
      expect(findButtonByLabel(components, 'キャンセル')).toBeDefined();
    });

    it('Given no items When building update selection components Then returns text display and cancel button only', () => {
      // When
      const components = InventoryFormatter.buildInventorySelectionComponents('content', [], 'update');

      // Then
      const containerComponents = getContainerComponents(components);
      expect(containerComponents).toHaveLength(2);
      expect(containerComponents[0]).toMatchObject({
        type: ComponentType.TextDisplay,
        content: 'content'
      });
      expect(findSelectMenu(components)).toBeUndefined();
      expect(findButtonByLabel(components, 'キャンセル')).toMatchObject({
        custom_id: 'inventory_selection_cancel',
        style: ButtonStyle.Secondary
      });
    });

    it('Given out of range page When building delete selection components Then clamps to last page and uses delete paging custom ids', () => {
      // Given
      const items = createItems(30);

      // When
      const components = InventoryFormatter.buildInventorySelectionComponents('content', items, 'delete', 99);

      // Then
      const selectMenu = findSelectMenu(components);
      expect(selectMenu.custom_id).toBe('inventory_delete_select_1');
      expect(selectMenu.options).toHaveLength(5);
      expect(findButtonByLabel(components, '前へ')).toMatchObject({
        custom_id: 'inventory_delete?page=0'
      });
      expect(findButtonByLabel(components, '次へ')).toBeUndefined();
    });
  });
});
