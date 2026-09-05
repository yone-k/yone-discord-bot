import { describe, it, expect } from 'vitest';
import { parseListCsv, serializeListCsv, parseListAdd, toDisplayListItem } from '../../src/utils/ListInput';
describe('ListInput', () => {
  it('CSVの引用符・カンマ・改行と明示カテゴリを往復する', () => {
    const items = [{ name: 'a,"b\nc', category: '食品', until: '2026-01-01', isCompleted: true }];
    expect(parseListCsv(serializeListCsv(items))).toEqual(items);
  });
  it.each(['a,,,\na,,,', 'a,,2026-02-30,', 'a,,,yes', 'a,,,,extra', '"unfinished'])('不正入力を部分採用しない: %s', text => expect(() => parseListCsv(text)).toThrow());
  it('空欄は全削除、通常名のヘッダー語や例を捨てない', () => {
    expect(parseListCsv('')).toEqual([]);
    expect(parseListCsv('name入り,,,\n例: 牛乳,,,').map(x => x.name)).toEqual(['name入り', '例: 牛乳']);
  });
  it('追加の期限と空カテゴリを保存値へ変換する', () => expect(parseListAdd('牛乳,2026-01-01\nパン', '')).toEqual([
    { name: '牛乳', category: null, until: '2026-01-01', isCompleted: false },
    { name: 'パン', category: null, until: null, isCompleted: false }
  ]));
  it('日付を東京の期限日として画面に変換する', () => {
    const item = toDisplayListItem({ name: 'a', category: null, until: '2026-01-01', isCompleted: false });
    expect(item.until?.toISOString()).toBe('2025-12-31T15:00:00.000Z');
  });
});
it('不正行と重複はCSV行位置を報告する', () => {
  expect(() => parseListCsv('a,,,\nb,,2026-02-30,')).toThrow('2行目');
  expect(() => parseListCsv('a,,,\na,,,')).toThrow('2行目');
});
it('保存済み一覧の前後空白をCSV往復で保持する', () => {
  const items = [{name:' milk ',category:' food ',until:null,isCompleted:false}];
  const csv = serializeListCsv(items);
  expect(csv).toBe('" milk "," food ",,');
  expect(parseListCsv(csv)).toEqual(items);
});
it('引用符なしの新規入力はtrimし、空カテゴリはNULLにする', () => {
  expect(parseListCsv(' milk , food ,,')).toEqual([{name:'milk',category:'food',until:null,isCompleted:false}]);
  expect(parseListCsv('milk,"",,')[0].category).toBeNull();
});
