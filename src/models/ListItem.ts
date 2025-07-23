import { CategoryType } from './CategoryType';

export interface ListItem {
  name: string;
  category: CategoryType | null;
  until: Date | null;
}

export function createListItem(name: string, category?: CategoryType | null, until?: Date | null): ListItem {
  return {
    name: name.trim(),
    category: category || null,
    until: until || null
  };
}

export function validateListItem(item: ListItem): void {
  if (!item.name || item.name.trim() === '') {
    throw new Error('商品名は必須です');
  }
  
  if (item.category !== null && (typeof item.category !== 'string' || item.category.trim() === '')) {
    throw new Error('無効なカテゴリです');
  }
  
  if (item.until !== null && (!(item.until instanceof Date) || isNaN(item.until.getTime()))) {
    throw new Error('期限日時が無効です');
  }
}