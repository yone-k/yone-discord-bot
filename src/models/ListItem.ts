import { CategoryType } from './CategoryType';

export interface ListItem {
  name: string;
  category: CategoryType | null;
  until: Date | null;
  check: boolean;
  lastNotifiedAt?: Date | null;
}

export function createListItem(
  name: string,
  category?: CategoryType | null,
  until?: Date | null,
  check?: boolean,
  lastNotifiedAt?: Date | null
): ListItem {
  return {
    name: name.trim(),
    category: category || null,
    until: until || null,
    check: check ?? false,
    lastNotifiedAt: lastNotifiedAt ?? null
  };
}

export function validateListItem(item: ListItem): void {
  if (!item.name || item.name.trim() === '') {
    throw new Error('名前は必須です');
  }
  
  if (item.category !== null && (typeof item.category !== 'string' || item.category.trim() === '')) {
    throw new Error('無効なカテゴリです');
  }
  
  if (item.until !== null && (!(item.until instanceof Date) || isNaN(item.until.getTime()))) {
    throw new Error('期限日時が無効です');
  }
  
  if (typeof item.check !== 'boolean') {
    throw new Error('完了状態が無効です');
  }

  if (item.lastNotifiedAt !== undefined && item.lastNotifiedAt !== null
    && (!(item.lastNotifiedAt instanceof Date) || isNaN(item.lastNotifiedAt.getTime()))) {
    throw new Error('最終通知日時が無効です');
  }
}
