import { describe, it, expect } from 'vitest';
import {
  parseInventoryInput,
  consumeInventory,
  getInsufficientInventoryItems,
  formatInventorySummary
} from '../../src/utils/RemindInventory';

describe('RemindInventory', () => {
  it('parses inventory input lines', () => {
    const text = '牛乳,在庫3,消費1\n卵,在庫2,消費1';
    const items = parseInventoryInput(text);

    expect(items).toEqual([
      { name: '牛乳', stock: 3, consume: 1 },
      { name: '卵', stock: 2, consume: 1 }
    ]);
  });

  it('rejects invalid inventory format', () => {
    expect(() => parseInventoryInput('牛乳,在庫3')).toThrow('消費が不足しています');
  });

  it('rejects duplicate item names', () => {
    expect(() => parseInventoryInput('牛乳,在庫3,消費1\n牛乳,在庫2,消費1')).toThrow('アイテム名が重複しています');
  });

  it('returns insufficient items when stock is below consume', () => {
    const items = [
      { name: '牛乳', stock: 0, consume: 1 },
      { name: '卵', stock: 2, consume: 1 }
    ];

    const insufficient = getInsufficientInventoryItems(items);
    expect(insufficient).toEqual([{ name: '牛乳', stock: 0, consume: 1 }]);
  });

  it('consumes inventory items', () => {
    const items = [
      { name: '牛乳', stock: 3, consume: 1 },
      { name: '卵', stock: 2, consume: 2 }
    ];

    expect(consumeInventory(items)).toEqual([
      { name: '牛乳', stock: 2, consume: 1 },
      { name: '卵', stock: 0, consume: 2 }
    ]);
  });

  it('formats inventory summary', () => {
    const items = [
      { name: '牛乳', stock: 3, consume: 1 },
      { name: '卵', stock: 2, consume: 1 }
    ];

    expect(formatInventorySummary(items)).toBe('在庫: 牛乳 3, 卵 2');
  });
});
