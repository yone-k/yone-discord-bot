import { describe, it, expect } from 'vitest';
import {
  parseInventoryInput,
  parseCompletionInput,
  formatInventoryShortageNotice,
} from '../../src/utils/RemindInventory';
import { quoteCsvCell } from '../../src/utils/Csv';

describe('RemindInventory', () => {
  it('passes negative quantities to the API consistently for labeled and positional input', () => {
    expect(parseInventoryInput('A,在庫-2,消費-1')).toEqual(parseInventoryInput('A,-2,-1'));
  });
  it.each([' milk ', 'a,b', 'a"b', 'a\nb', 'a;b'])('retains the exact CSV name %j in both input modes', name => {
    const cell = quoteCsvCell(name);
    expect(parseInventoryInput(`${cell},1.234,0.0123`)).toEqual([{ name, stock: '1.234', consume: '0.0123' }]);
    expect(parseCompletionInput(`${cell},0.0123`)).toEqual([{ name, consume: '0.0123' }]);
  });
  it('preserves original precision for inventory settings until the transactional comparison', () => {
    expect(parseInventoryInput('A,1.234,0.0123')).toEqual([{ name: 'A', stock: '1.234', consume: '0.0123' }]);
  });
  it.each(['A,消費1,unexpected', 'A,消費1,消費2', 'A,在庫1,在庫2'])('rejects unconsumed or duplicate quantity tokens %s', input => {
    expect(() => parseInventoryInput(input)).toThrow();
  });
  it('resolves labeled stock and equal unlabeled consume without comparing token values', () => {
    expect(parseInventoryInput('A,在庫5,5')).toEqual([{ name: 'A', stock: '5', consume: '5' }]);
  });
  it('parses inventory input lines', () => {
    const text = 'フィルター,1\n替えブラシ,2';
    const items = parseInventoryInput(text);

    expect(items).toEqual([
      { name: 'フィルター', stock: undefined, consume: '1' },
      { name: '替えブラシ', stock: undefined, consume: '2' }
    ]);
  });

  it('parses inventory input with stock and consume columns', () => {
    expect(parseInventoryInput('米,5,1')).toEqual([
      { name: '米', stock: '5', consume: '1' }
    ]);
  });

  it('allows zero consume with stock and consume columns', () => {
    expect(parseInventoryInput('アイテム名,5,0')).toEqual([
      { name: 'アイテム名', stock: '5', consume: '0' }
    ]);
  });

  it('keeps two-column inventory input backward compatible', () => {
    expect(parseInventoryInput('米,1')).toEqual([
      { name: '米', stock: undefined, consume: '1' }
    ]);
  });

  it('allows zero consume with two-column inventory input', () => {
    expect(parseInventoryInput('アイテム名,0')).toEqual([
      { name: 'アイテム名', stock: undefined, consume: '0' }
    ]);
  });

  it('parses labeled stock and consume input', () => {
    expect(parseInventoryInput('米,在庫:5,消費:1')).toEqual([
      { name: '米', stock: '5', consume: '1' }
    ]);
  });

  it('rejects inventory input with too many tokens', () => {
    expect(() => parseInventoryInput('米,5,1,2')).toThrow('在庫の形式が不正です');
  });

  it('parses decimal stock and consume values', () => {
    expect(parseInventoryInput('米,5.5,1.5')).toEqual([
      { name: '米', stock: '5.5', consume: '1.5' }
    ]);
  });

  it('preserves decimal inventory input precision', () => {
    const text = 'フィルター,1.44\n替えブラシ,消費0.55';
    const items = parseInventoryInput(text);

    expect(items).toEqual([
      { name: 'フィルター', stock: undefined, consume: '1.44' },
      { name: '替えブラシ', stock: undefined, consume: '0.55' }
    ]);
  });

  it('preserves signed numeric input for domain range validation', () => {
    expect(parseInventoryInput('アイテム名,-1')[0].consume).toBe('-1');
  });

  it('rejects invalid inventory format', () => {
    expect(() => parseInventoryInput('フィルター')).toThrow('在庫の形式が不正です');
  });

  it('preserves duplicate names for API validation', () => {
    expect(parseInventoryInput('フィルター,1\nフィルター,2')).toHaveLength(2);
  });

  it('formats inventory shortage notice with counts', () => {
    const items = [
      { inventoryId: '牛乳', name: '牛乳', available: '1.2', required: '1.5' },
      { inventoryId: '卵', name: '卵', available: '0', required: '3' }
    ];

    expect(formatInventoryShortageNotice(items)).toBe(
      '不足している在庫の詳細は以下の通りです\n牛乳 0.3個\n卵 3個'
    );
  });

  describe('parseCompletionInput', () => {
    it('parses completion input lines with consume values', () => {
      expect(parseCompletionInput('アイテムA,3\nアイテムB,1.5')).toEqual([
        { name: 'アイテムA', consume: '3' },
        { name: 'アイテムB', consume: '1.5' }
      ]);
    });

    it('parses omitted consume as null when the consume column is empty', () => {
      expect(parseCompletionInput('アイテムA,')).toEqual([
        { name: 'アイテムA', consume: null }
      ]);
    });

    it('allows zero consume values', () => {
      expect(parseCompletionInput('アイテムA,0')).toEqual([
        { name: 'アイテムA', consume: '0' }
      ]);
    });

    it('skips blank and whitespace-only lines', () => {
      expect(parseCompletionInput('\n  \nアイテムA,3\n\t\nアイテムB,1')).toEqual([
        { name: 'アイテムA', consume: '3' },
        { name: 'アイテムB', consume: '1' }
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

    it('preserves duplicate names for API validation', () => {
      expect(parseCompletionInput('A,1\nA,2')).toHaveLength(2);
    });

    it('preserves signed numeric input for domain range validation', () => {
      expect(parseCompletionInput('A,-1')[0].consume).toBe('-1');
    });

    it('rejects invalid consume numbers', () => {
      expect(() => parseCompletionInput('A,abc')).toThrow();
    });

    it('returns an empty array for empty input', () => {
      expect(parseCompletionInput('')).toEqual([]);
    });
  });
});
