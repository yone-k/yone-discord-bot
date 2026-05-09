import type { InventoryItem } from '../models/InventoryItem';
import { DEFAULT_CATEGORY } from '../models/CategoryType';

export interface InventoryCsvItem {
  name: string;
  stock: number;
  category?: string;
}

const roundStock = (value: number): number => Math.round(value * 10) / 10;

const formatStock = (value: number): string => {
  const rounded = roundStock(value);
  const fixed = rounded.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
};

export const parseInventoryCsvText = (text: string): InventoryCsvItem[] => {
  if (!text) {
    return [];
  }

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '');

  return lines.map((line, index) => {
    const tokens = line.split(',').map(token => token.trim());
    if (tokens.length < 2 || tokens.length > 3) {
      throw new Error(`${index + 1}行目: 「名前,在庫数,カテゴリ」の形式で入力してください`);
    }

    const [name, stockText, categoryRaw] = tokens;
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
      category: categoryRaw === undefined || categoryRaw === '' ? undefined : categoryRaw,
    };
  });
};

export const formatInventoryCsvText = (
  items: Pick<InventoryItem, 'name' | 'stock' | 'category'>[],
  defaultCategory?: string
): string => {
  const enriched = items.map(item => ({
    ...item,
    category: item.category && item.category.trim() !== '' ? item.category : (defaultCategory ?? '')
  }));

  const grouped = new Map<string, typeof enriched>();
  for (const item of enriched) {
    const cat = item.category || DEFAULT_CATEGORY;
    if (!grouped.has(cat)) {
      grouped.set(cat, []);
    }
    grouped.get(cat)!.push(item);
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

  const lines: string[] = [];
  for (const cat of sortedCategories) {
    for (const item of grouped.get(cat)!) {
      const stockStr = formatStock(item.stock);
      const category = item.category && item.category.trim() !== '' ? item.category : undefined;
      lines.push(category ? `${item.name},${stockStr},${category}` : `${item.name},${stockStr}`);
    }
  }

  return lines.join('\n');
};
