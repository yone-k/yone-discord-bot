import { ListItem } from '../models/ListItem';
import { ListEditItem } from '../api/contracts';
import { parseCsvRecords, quoteCsvCell } from './Csv';
function date(value: string): string | null {
  if (!value)
    return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number(value.slice(0, 4)))
    throw new Error('期限はYYYY-MM-DDで入力してください');
  return value;
}
function parse(text: string, convert: (cells: string[]) => ListEditItem): ListEditItem[] {
  const input = parseCsvRecords(text);
  if (input.length > 100) throw new Error('アイテムは最大100件です');
  return input.map(({ cells, line }) => {
    try {
      const item = convert(cells);
      if (!item.name) throw new Error('名前は必須です');
      return item;
    }
    catch (error) {
      throw new Error(`${line}行目: ${error instanceof Error ? error.message : '入力が不正です'}`);
    }
  });
}
export function parseListCsv(text: string): ListEditItem[] {
  return parse(text, row => {
    if (row.length > 4)
      throw new Error('CSVは名前,カテゴリ,期限,完了の4列です');
    const [name, category = '', until = '', check = ''] = row;
    if (!['', '0', '1'].includes(check))
      throw new Error('完了は0または1で入力してください');
    return { name, category: category || null, until: date(until), isCompleted: check === '1' };
  });
}
export function parseListAdd(text: string, category: string): ListEditItem[] {
  const items = parse(text, row => {
    if (row.length > 2)
      throw new Error('追加は名前,期限の2列です');
    return { name: row[0], category: category.trim() || null, until: date(row[1] || ''), isCompleted: false };
  });
  if (!items.length)
    throw new Error('名前は必須です');
  return items;
}
export function serializeListCsv(items: ListEditItem[]): string {
  return items.map(item => [item.name, item.category || '', item.until || '', item.isCompleted ? '1' : '']
    .map(quoteCsvCell).join(',')).join('\n');
}
export function toDisplayListItem(item: ListEditItem & {
    lastNotifiedAt?: Date | null;
}): ListItem {
  return { name: item.name, category: item.category, until: item.until ? new Date(`${item.until}T00:00:00+09:00`) : null,
    check: item.isCompleted, lastNotifiedAt: item.lastNotifiedAt ?? null };
}
