import { describe, it, expect } from 'vitest';
import {
  parseInventoryInput,
  parseCompletionInput,
  consumeInventory,
  getInsufficientInventoryItems,
  formatInventoryShortageNotice,
  formatInventorySummary
} from '../../src/utils/RemindInventory';

describe('RemindInventory', () => {
  it('parses inventory input lines', () => {
    const text = 'フィルター,1\n替えブラシ,2';
    const items = parseInventoryInput(text);

    expect(items).toEqual([
      { name: 'フィルター', stock: undefined, consume: 1 },
      { name: '替えブラシ', stock: undefined, consume: 2 }
    ]);
  });

  it('parses inventory input with stock and consume columns', () => {
    expect(parseInventoryInput('米,5,1')).toEqual([
      { name: '米', stock: 5, consume: 1 }
    ]);
  });

  it('allows zero consume with stock and consume columns', () => {
    expect(parseInventoryInput('アイテム名,5,0')).toEqual([
      { name: 'アイテム名', stock: 5, consume: 0 }
    ]);
  });

  it('keeps two-column inventory input backward compatible', () => {
    expect(parseInventoryInput('米,1')).toEqual([
      { name: '米', stock: undefined, consume: 1 }
    ]);
  });

  it('allows zero consume with two-column inventory input', () => {
    expect(parseInventoryInput('アイテム名,0')).toEqual([
      { name: 'アイテム名', stock: undefined, consume: 0 }
    ]);
  });

  it('parses labeled stock and consume input', () => {
    expect(parseInventoryInput('米,在庫:5,消費:1')).toEqual([
      { name: '米', stock: 5, consume: 1 }
    ]);
  });

  it('rejects inventory input with too many tokens', () => {
    expect(() => parseInventoryInput('米,5,1,2')).toThrow('在庫の形式が不正です');
  });

  it('parses decimal stock and consume values', () => {
    expect(parseInventoryInput('米,5.5,1.5')).toEqual([
      { name: '米', stock: 5.5, consume: 1.5 }
    ]);
  });

  it('parses decimal inventory input and rounds to one decimal', () => {
    const text = 'フィルター,1.44\n替えブラシ,消費0.55';
    const items = parseInventoryInput(text);

    expect(items).toEqual([
      { name: 'フィルター', stock: undefined, consume: 1.4 },
      { name: '替えブラシ', stock: undefined, consume: 0.6 }
    ]);
  });

  it('rejects negative consume values', () => {
    expect(() => parseInventoryInput('アイテム名,-1')).toThrow();
  });

  it('rejects invalid inventory format', () => {
    expect(() => parseInventoryInput('フィルター')).toThrow('在庫の形式が不正です');
  });

  it('rejects duplicate item names', () => {
    expect(() => parseInventoryInput('フィルター,1\nフィルター,2')).toThrow('アイテム名が重複しています');
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

  describe('parseCompletionInput', () => {
    it('parses completion input lines with consume values', () => {
      expect(parseCompletionInput('アイテムA,3\nアイテムB,1.5')).toEqual([
        { name: 'アイテムA', consume: 3 },
        { name: 'アイテムB', consume: 1.5 }
      ]);
    });

    it('parses omitted consume as null when the consume column is empty', () => {
      expect(parseCompletionInput('アイテムA,')).toEqual([
        { name: 'アイテムA', consume: null }
      ]);
    });

    it('allows zero consume values', () => {
      expect(parseCompletionInput('アイテムA,0')).toEqual([
        { name: 'アイテムA', consume: 0 }
      ]);
    });

    it('skips blank and whitespace-only lines', () => {
      expect(parseCompletionInput('\n  \nアイテムA,3\n\t\nアイテムB,1')).toEqual([
        { name: 'アイテムA', consume: 3 },
        { name: 'アイテムB', consume: 1 }
      ]);
    });

    it('rejects input with three or more tokens', () => {
      expect(() => parseCompletionInput('A,1,2')).toThrow();
    });

    it('allows item-name-only lines and parses consume as null', () => {
      expect(parseCompletionInput('アイテムA')).toEqual([
        { name: 'アイテムA', consume: null }
      ]);
    });

    it('rejects duplicate item names', () => {
      expect(() => parseCompletionInput('A,1\nA,2')).toThrow();
    });

    it('rejects negative consume values', () => {
      expect(() => parseCompletionInput('A,-1')).toThrow();
    });

    it('rejects invalid consume numbers', () => {
      expect(() => parseCompletionInput('A,abc')).toThrow();
    });

    it('returns an empty array for empty input', () => {
      expect(parseCompletionInput('')).toEqual([]);
    });
  });
});
