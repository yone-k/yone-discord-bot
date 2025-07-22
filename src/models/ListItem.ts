import { CategoryType } from './CategoryType';

export interface ListItem {
  name: string;
  quantity: string | null;
  category: CategoryType | null;
  addedAt: Date | null;
  until: Date | null;
}

export function createListItem(name: string, quantity?: string | null, category?: CategoryType | null, until?: Date | null): ListItem {
  return {
    name: name.trim(),
    quantity: quantity || null,
    category: category || null,
    addedAt: new Date(),
    until: until || null
  };
}

export function validateListItem(item: ListItem): void {
  if (!item.name || item.name.trim() === '') {
    throw new Error('商品名は必須です');
  }
  
  if (item.quantity !== null && typeof item.quantity !== 'string') {
    throw new Error('数量は文字列である必要があります');
  }
  
  if (item.category !== null && (typeof item.category !== 'string' || item.category.trim() === '')) {
    throw new Error('無効なカテゴリです');
  }
  
  if (item.addedAt !== null && (!(item.addedAt instanceof Date) || isNaN(item.addedAt.getTime()))) {
    throw new Error('追加日時が無効です');
  }
  
  if (item.until !== null && (!(item.until instanceof Date) || isNaN(item.until.getTime()))) {
    throw new Error('期限日時が無効です');
  }
}