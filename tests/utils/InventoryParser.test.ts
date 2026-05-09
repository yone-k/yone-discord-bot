import { parseInventoryCsvText, formatInventoryCsvText } from '../../src/utils/InventoryParser';

describe('parseInventoryCsvText', () => {
  it('parses single line with category', () => {
    expect(parseInventoryCsvText('洗剤,5,日用品')).toEqual([
      { name: '洗剤', stock: 5, category: '日用品' },
    ]);
  });

  it('parses single line without category', () => {
    expect(parseInventoryCsvText('洗剤,5')).toEqual([
      { name: '洗剤', stock: 5, category: undefined },
    ]);
  });

  it('parses multiple lines', () => {
    const text = '洗剤,5,日用品\nパン,3,食料品';
    expect(parseInventoryCsvText(text)).toHaveLength(2);
  });

  it('skips empty lines', () => {
    const text = '洗剤,5\n\n  \nパン,3';
    expect(parseInventoryCsvText(text)).toHaveLength(2);
  });

  it('throws on too many tokens', () => {
    expect(() => parseInventoryCsvText('a,1,b,c')).toThrow();
  });

  it('throws on empty name', () => {
    expect(() => parseInventoryCsvText(',5,日用品')).toThrow();
  });

  it('throws on non-numeric stock', () => {
    expect(() => parseInventoryCsvText('洗剤,abc,日用品')).toThrow();
  });

  it('throws on negative stock', () => {
    expect(() => parseInventoryCsvText('洗剤,-1,日用品')).toThrow();
  });

  it('accepts decimal stock and rounds to 1 decimal', () => {
    expect(parseInventoryCsvText('洗剤,5.5,日用品')).toEqual([
      { name: '洗剤', stock: 5.5, category: '日用品' },
    ]);
  });
});

describe('formatInventoryCsvText', () => {
  it('formats inventory items as CSV with category', () => {
    const items = [
      { id: 'i1', name: '洗剤', stock: 5, category: '日用品' },
      { id: 'i2', name: 'パン', stock: 3, category: '食料品' },
    ];
    expect(formatInventoryCsvText(items)).toBe('パン,3,食料品\n洗剤,5,日用品');
  });

  it('formats item without category as 名前,数 (omit empty trailing comma)', () => {
    const items = [{ id: 'i1', name: '洗剤', stock: 5, category: '' }];
    expect(formatInventoryCsvText(items)).toBe('洗剤,5');
  });

  it('formats decimal stock without trailing zeros', () => {
    const items = [{ id: 'i1', name: '洗剤', stock: 5.5, category: '日用品' }];
    expect(formatInventoryCsvText(items)).toBe('洗剤,5.5,日用品');
  });

  it('returns empty string for empty array', () => {
    expect(formatInventoryCsvText([])).toBe('');
  });
});

describe('formatInventoryCsvText with defaultCategory', () => {
  it('fills empty category with defaultCategory', () => {
    const items = [{ id: '1', name: 'パン', stock: 3, category: '' }];
    expect(formatInventoryCsvText(items, '食料品')).toBe('パン,3,食料品');
  });

  it('sorts by category (その他最後, ja-JP昇順) but preserves input order within category', () => {
    const items = [
      { id: '1', name: '米', stock: 5, category: '食料品' },
      { id: '2', name: '洗剤', stock: 1, category: '日用品' },
      { id: '3', name: '箸', stock: 2, category: 'その他' },
      { id: '4', name: 'パン', stock: 3, category: '食料品' },
    ];
    const csv = formatInventoryCsvText(items);
    const lines = csv.split('\n');
    // カテゴリ順: 食料品 → 日用品 → その他
    // 食料品内: 米(入力順1番目) → パン(入力順2番目)
    expect(lines[0]).toBe('米,5,食料品');
    expect(lines[1]).toBe('パン,3,食料品');
    expect(lines[2]).toBe('洗剤,1,日用品');
    expect(lines[3]).toBe('箸,2,その他');
  });

  it('sorts items with defaultCategory-filled empty categories alongside others (input order within group)', () => {
    const items = [
      { id: '1', name: '米', stock: 5, category: '食料品' },
      { id: '2', name: 'パン', stock: 3, category: '' },
    ];
    expect(formatInventoryCsvText(items, '食料品'))
      .toBe('米,5,食料品\nパン,3,食料品');
  });
});
