import { DEFAULT_CATEGORY } from '../models/CategoryType';

/** 比較用カテゴリのみ補完し、元データと同値項目の入力順を保持する。 */
export function orderItemsForForm<T extends { name: string; category?: string | null }>(items: readonly T[], defaultCategory?: string): T[] {
  const category = (item: T): string => item.category?.trim() || defaultCategory?.trim() || DEFAULT_CATEGORY;
  return [...items].sort((a, b) => {
    const left = category(a);
    const right = category(b);
    if (left !== right) {
      if (left === DEFAULT_CATEGORY) return 1;
      if (right === DEFAULT_CATEGORY) return -1;
    }
    return left.localeCompare(right, 'ja') || a.name.localeCompare(b.name, 'ja');
  });
}
