import { describe, it, expect } from 'vitest';
import type { InventoryItem } from '../../src/models/InventoryItem';
import { getInventorySheetHeaders, toSheetRow, fromSheetRow } from '../../src/utils/InventorySheetMapper';

describe('InventorySheetMapper', () => {
  it('returns inventory sheet headers', () => {
    const headers = getInventorySheetHeaders();

    expect(headers).toEqual(['id', 'name', 'stock', 'category']);
  });

  it('converts inventory item to sheet row', () => {
    const item: InventoryItem = {
      id: 'item-1',
      name: 'Coffee beans',
      stock: 2,
      category: 'food'
    };

    const row = toSheetRow(item);

    expect(row).toEqual(['item-1', 'Coffee beans', 2, 'food']);
  });

  it('converts sheet row to inventory item', () => {
    const row = ['item-1', 'Coffee beans', '2', 'food'];

    const item = fromSheetRow(row);

    expect(item).toEqual({
      id: 'item-1',
      name: 'Coffee beans',
      stock: 2,
      category: 'food'
    });
  });

  it('parses decimal stock from sheet row', () => {
    const row = ['item-2', 'Detergent', '1.5', 'daily'];

    const item = fromSheetRow(row);

    expect(item.stock).toBe(1.5);
  });

  it.each([
    [''],
    ['invalid']
  ])('falls back to 0 when stock is %s', (stock) => {
    const row = ['item-3', 'Soap', stock, 'daily'];

    const item = fromSheetRow(row);

    expect(item.stock).toBe(0);
  });

  it('keeps empty category from sheet row', () => {
    const row = ['item-4', 'Uncategorized item', '3', ''];

    const item = fromSheetRow(row);

    expect(item.category).toBe('');
  });

  it('round trips inventory item through sheet row', () => {
    const original: InventoryItem = {
      id: 'item-5',
      name: 'Printer paper',
      stock: 12.5,
      category: 'office'
    };

    const row = toSheetRow(original).map(String);
    const restored = fromSheetRow(row);

    expect(restored).toEqual(original);
  });
});
