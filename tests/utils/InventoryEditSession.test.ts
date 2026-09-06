import { describe, it, expect } from 'vitest';
import { InventoryEditSession } from '../../src/utils/InventoryEditSession';
import { formatInventoryEditCsv, parseInventoryEditCsv } from '../../src/utils/InventoryParser';
describe('在庫編集snapshot', () => {
  const original = [{ id: '任意ID', name: '洗剤', stock: '9007199254740993.123456789', category: '' }];
  it('行番号で名称変更してもID・未編集数量精度・カテゴリ未指定を保持する', () => {
    const csv = formatInventoryEditCsv(original, '既定');
    expect(csv).toBe('1,洗剤,9007199254740993.123456789,');
    const saved = parseInventoryEditCsv(csv.replace('洗剤', '石鹸'), original);
    expect(saved).toEqual([{ ...original[0], name: '石鹸' }]);
  });
  it('変更数量の精度を維持し、新規行はAPIの採番に任せる', () => {
    const saved = parseInventoryEditCsv('1,洗剤,1.26,\n,米,3.45,食品', original);
    expect(saved[0].stock).toBe('1.26');
    expect(saved[1]).toMatchObject({ name: '米', stock: '3.45', category: '食品' });
    expect(saved[1].id).toBe('');
  });
  it.each(['2,洗剤,1,', '1,洗剤,1,\n1,米,2,'])('不正番号と重複は全拒否 %s', csv => expect(() => parseInventoryEditCsv(csv, original)).toThrow());
  it('利用者・チャンネル・期限を照合する', () => {
    const store = new InventoryEditSession(1000);
    const token = store.open('1', '2', original, 0);
    expect(store.get(token, '1', '2', 500)).toEqual(original);
    expect(() => store.get(token, '1', '3', 500)).toThrow();
    expect(() => store.get(token, '3', '2', 500)).toThrow();
    expect(() => store.get(token, '1', '2', 1000)).toThrow('期限');
  });
});
it('在庫の前後空白付き名称とカテゴリをIDごとそのまま保存する', () => {
  const original = [{id:'stable-id',name:' milk ',stock:'1.23456789',category:' food '}];
  const csv = formatInventoryEditCsv(original);
  expect(csv).toBe('1," milk ",1.23456789," food "');
  expect(parseInventoryEditCsv(csv,original)).toEqual(original);
});
