import type { InventoryItem } from '../models/InventoryItem';
import { DEFAULT_CATEGORY } from '../models/CategoryType';
import { formatDecimal, normalizeDecimal } from './Decimal';
import { randomUUID } from 'node:crypto';
import { parseCsvRecords, quoteCsvCell } from './Csv';
export interface InventoryAddCsvItem {
    name: string;
    stock: string;
}
const splitCsvLines = (text: string): string[] => {
  if (!text) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '');
};
const parseNameAndStock = (name: string, stockText: string, index: number): InventoryAddCsvItem => {
  if (!name) {
    throw new Error(`${index + 1}行目: 名前が空です`);
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(stockText)) {
    throw new Error(`${index + 1}行目: 在庫数は数値で入力してください`);
  }
  if (stockText.startsWith('-')) {
    throw new Error(`${index + 1}行目: 在庫数は0以上で入力してください`);
  }
  const stock = formatDecimal(stockText);
  return {
    name,
    stock,
  };
};
export const parseInventoryAddCsvText = (text: string): InventoryAddCsvItem[] => {
  const lines = splitCsvLines(text);
  return lines.map((line, index) => {
    const tokens = line.split(',').map(token => token.trim());
    if (tokens.length !== 2) {
      throw new Error(`${index + 1}行目: 「名前,在庫数」の形式で入力してください`);
    }
    const [name, stockText] = tokens;
    return parseNameAndStock(name, stockText, index);
  });
};
export const orderInventoryItemsForCsv = <T extends Pick<InventoryItem, 'name' | 'stock' | 'category'>>(items: T[], defaultCategory?: string): T[] => {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const effective = item.category && item.category.trim() !== ''
      ? item.category
      : (defaultCategory ?? '');
    const groupKey = effective || DEFAULT_CATEGORY;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
        grouped.get(groupKey)!.push(item);
  }
  const sortedCategories = [...grouped.keys()].sort((a, b) => {
    if (a === DEFAULT_CATEGORY) {
      return 1;
    }
    if (b === DEFAULT_CATEGORY) {
      return -1;
    }
    return a.localeCompare(b, 'ja');
  });
  const ordered: T[] = [];
  for (const cat of sortedCategories) {
    ordered.push(...grouped.get(cat)!);
  }
  return ordered;
};
/** 行番号は編集開始時の在庫IDに対応する。新規行だけ番号を空欄にする。 */
export function formatInventoryEditCsv(items: InventoryItem[], defaultCategory?: string): string {
  const numbers = new Map(items.map((item, index) => [item.id, String(index + 1)]));
  return orderInventoryItemsForCsv(items, defaultCategory).map(item => [numbers.get(item.id)!, item.name, item.stock, item.category].map(quoteCsvCell).join(',')).join('\n');
}
export function parseInventoryEditCsv(text: string, original: InventoryItem[]): InventoryItem[] {
  const used = new Set<string>(), names = new Set<string>();
  return parseCsvRecords(text).map(({ cells, line }) => {
    try {
      if (cells.length !== 4)
        throw new Error('行番号,名前,在庫数,カテゴリの4列で入力してください');
      const [number, name, stock, category] = cells;
      if (!name)
        throw new Error('名前は必須です');
      if (names.has(name))
        throw new Error('名前が重複しています');
      names.add(name);
      const normalized = normalizeDecimal(stock);
      let previous: InventoryItem | undefined;
      if (number) {
        if (!/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number)) || Number(number) > original.length)
          throw new Error('行番号が不正です');
        if (used.has(number))
          throw new Error('行番号が重複しています');
        used.add(number);
        previous = original[Number(number) - 1];
      }
      return { id: previous?.id || randomUUID(), name, stock: previous && normalizeDecimal(previous.stock) === normalized ? previous.stock : formatDecimal(stock), category };
    }
    catch (error) {
      throw new Error(`${line}行目: ${error instanceof Error ? error.message : '入力が不正です'}`);
    }
  });
}
