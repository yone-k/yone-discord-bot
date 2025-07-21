import { CategoryType } from './CategoryType';
import { randomUUID } from 'crypto';

export interface ListItem {
  id: string;
  name: string;
  quantity: number;
  category: CategoryType;
  addedAt: Date;
}

export function createListItem(name: string, quantity: number, category: CategoryType): ListItem {
  return {
    id: randomUUID(),
    name: name.trim(),
    quantity,
    category,
    addedAt: new Date()
  };
}

export function validateListItem(item: ListItem): void {
  if (!item.id) {
    throw new Error('IDは必須です');
  }
  
  if (!item.name || item.name.trim() === '') {
    throw new Error('商品名は必須です');
  }
  
  if (typeof item.quantity !== 'number' || item.quantity <= 0) {
    throw new Error('数量は1以上である必要があります');
  }
  
  if (!Object.values(CategoryType).includes(item.category)) {
    throw new Error('無効なカテゴリです');
  }
  
  if (!(item.addedAt instanceof Date) || isNaN(item.addedAt.getTime())) {
    throw new Error('追加日時が無効です');
  }
}