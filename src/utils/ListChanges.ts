import { ListEditItem } from '../api/contracts';
import { OperationDetails } from '../models/types/OperationLog';
import { toDisplayListItem } from './ListInput';
export function listChanges(before: ListEditItem[], after: ListEditItem[]): OperationDetails['changes'] {
  const beforeMap = new Map(before.map(item => [item.name, item]));
  const afterMap = new Map(after.map(item => [item.name, item]));
  return {
    added: after.filter(item => !beforeMap.has(item.name)).map(toDisplayListItem),
    removed: before.filter(item => !afterMap.has(item.name)).map(toDisplayListItem),
    modified: after.flatMap(item => {
      const previous = beforeMap.get(item.name);
      if (!previous || (previous.category === item.category && previous.until === item.until && previous.isCompleted === item.isCompleted))
        return [];
      return [{ name: item.name, before: toDisplayListItem(previous), after: toDisplayListItem(item) }];
    })
  };
}
export function listLogItems(items: ListEditItem[]): OperationDetails['items'] {
  return items.map(toDisplayListItem).map(item => ({ name: item.name, category: item.category || 'その他', quantity: 1, until: item.until || undefined }));
}
