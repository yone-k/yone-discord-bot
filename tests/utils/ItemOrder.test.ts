import { describe, expect, it } from 'vitest';
import { orderItemsForForm } from '../../src/utils/ItemOrder';
import { parseListCsv, serializeListCsv } from '../../src/utils/ListInput';
import { formatInventoryEditCsv, parseInventoryEditCsv } from '../../src/utils/InventoryParser';

describe('フォームのカテゴリ・名前順', () => {
  const items = [
    { id: 'z', name: 'z', category: ' A ', stock: '9007199254740993.12345' },
    { id: 'other', name: 'a', category: 'その他', stock: '1' },
    { id: 'b', name: 'b', category: '', stock: '2' },
    { id: 'a', name: 'a,"\n', category: 'A', stock: '3' },
    { id: 'same', name: 'b', category: 'A', stock: '4' }
  ];
  it('比較用にだけカテゴリを補完し、同値の入力順と元データを保持する', () => {
    const original = structuredClone(items);
    expect(orderItemsForForm(items, ' A ').map(x => x.id)).toEqual(['a', 'b', 'same', 'z', 'other']);
    expect(items).toEqual(original);
    expect(orderItemsForForm([], ' ')).toEqual([]);
  });
  it('通常リストの並べ替え後もCSVの引用と空カテゴリを保持する', () => {
    const list = items.map(x => ({ name: x.name, category: x.category || null, until: null, isCompleted: false }));
    expect(parseListCsv(serializeListCsv(list, 'A'))).toEqual([list[3], list[2], list[4], list[0], list[1]]);
    expect(serializeListCsv([])).toBe('');
  });
  it('在庫の表示順と元番号を分離し、名称変更後もIDと数量を保持する', () => {
    const csv = formatInventoryEditCsv(items, 'A');
    const parsed = parseInventoryEditCsv(csv, items);
    expect(parsed.map(x => x.id)).toEqual(['a', 'b', 'same', 'z', 'other']);
    expect(parsed[3]).toEqual(items[0]);
    expect(parseInventoryEditCsv(csv.replace('1,z,', '1,renamed,'), items)[3]).toEqual({ ...items[0], name: 'renamed' });
    expect(formatInventoryEditCsv([])).toBe('');
  });
});
