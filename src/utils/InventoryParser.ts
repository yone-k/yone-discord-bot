import type { InventoryItem } from '../models/InventoryItem';
import { DEFAULT_CATEGORY } from '../models/CategoryType';

export interface InventoryCsvItem {
  name: string;
  stock: number;
  category?: string;
}

export interface InventoryAddCsvItem {
  name: string;
  stock: number;
}

const roundStock = (value: number): number => Math.round(value * 10) / 10;

const formatStock = (value: number): string => {
  const rounded = roundStock(value);
  const fixed = rounded.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
};

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

  const stock = roundStock(Number(stockText));
  if (stock < 0) {
    throw new Error(`${index + 1}行目: 在庫数は0以上で入力してください`);
  }

  return {
    name,
    stock,
  };
};

export const parseInventoryCsvText = (text: string): InventoryCsvItem[] => {
  const lines = splitCsvLines(text);

  return lines.map((line, index) => {
    const tokens = line.split(',').map(token => token.trim());
    if (tokens.length < 2 || tokens.length > 3) {
      throw new Error(`${index + 1}行目: 「名前,在庫数,カテゴリ」の形式で入力してください`);
    }

    const [name, stockText, categoryRaw] = tokens;
    const item = parseNameAndStock(name, stockText, index);

    return {
      ...item,
      category: categoryRaw === undefined || categoryRaw === '' ? undefined : categoryRaw,
    };
  });
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

export const orderInventoryItemsForCsv = <T extends Pick<InventoryItem, 'name' | 'stock' | 'category'>>(
  items: T[],
  defaultCategory?: string
): T[] => {
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

export const formatInventoryCsvText = (
  items: Pick<InventoryItem, 'name' | 'stock' | 'category'>[],
  defaultCategory?: string
): string => {
  const ordered = orderInventoryItemsForCsv(items, defaultCategory);

  const lines: string[] = [];
  for (const item of ordered) {
    const stockStr = formatStock(item.stock);
    const effective = item.category && item.category.trim() !== ''
      ? item.category
      : (defaultCategory ?? '');
    lines.push(effective ? `${item.name},${stockStr},${effective}` : `${item.name},${stockStr}`);
  }

  return lines.join('\n');
};
