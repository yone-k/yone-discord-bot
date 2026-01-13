import { describe, it, expect } from 'vitest';
import {
  parseInventoryInput,
  consumeInventory,
  getInsufficientInventoryItems,
  formatInventoryShortageNotice,
  formatInventorySummary
} from '../../src/utils/RemindInventory';

describe('RemindInventory', () => {
  it('parses inventory input lines', () => {
    const text = 'フィルター,1,3\n替えブラシ,2,5';
    const items = parseInventoryInput(text);

    expect(items).toEqual([
      { name: 'フィルター', stock: 3, consume: 1 },
      { name: '替えブラシ', stock: 5, consume: 2 }
    ]);
  });

  it('parses decimal inventory input and rounds to one decimal', () => {
    const text = 'フィルター,1.44,3.46\n替えブラシ,消費0.55,在庫2.04';
    const items = parseInventoryInput(text);

    expect(items).toEqual([
      { name: 'フィルター', stock: 3.5, consume: 1.4 },
      { name: '替えブラシ', stock: 2, consume: 0.6 }
    ]);
  });

  it('rejects when rounded consume becomes zero', () => {
    expect(() => parseInventoryInput('フィルター,0.04,3')).toThrow('消費は0より大きい数値で入力してください');
  });

  it('rejects invalid inventory format', () => {
    expect(() => parseInventoryInput('フィルター,1')).toThrow('在庫が不足しています');
  });

  it('rejects duplicate item names', () => {
    expect(() => parseInventoryInput('フィルター,1,3\nフィルター,2,5')).toThrow('アイテム名が重複しています');
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
      { name: '卵', stock: 2.5, consume: 1 }
    ];

    expect(formatInventorySummary(items)).toBe('在庫: 牛乳 3, 卵 2.5');
  });

  it('formats inventory shortage notice with counts', () => {
    const items = [
      { name: '牛乳', stock: 1.2, consume: 1.5 },
      { name: '卵', stock: 0, consume: 3 }
    ];

    expect(formatInventoryShortageNotice(items)).toBe(
      '不足している在庫の詳細は以下の通りです\n牛乳 0.3個\n卵 3個'
    );
  });
});
