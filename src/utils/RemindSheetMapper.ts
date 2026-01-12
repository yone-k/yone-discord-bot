import { createRemindTask, RemindTask } from '../models/RemindTask';

const TOKYO_OFFSET_MINUTES = 9 * 60;
const DEFAULT_REMIND_BEFORE_MINUTES = 1440;

export function getRemindSheetHeaders(): string[] {
  return [
    'id',
    'message_id',
    'title',
    'description',
    'interval_days',
    'time_of_day',
    'remind_before_minutes',
    'inventory_items',
    'start_at',
    'next_due_at',
    'last_done_at',
    'last_remind_due_at',
    'overdue_notify_count',
    'overdue_notify_limit',
    'last_overdue_notified_at',
    'is_paused',
    'created_at',
    'updated_at'
  ];
}

export function toSheetRow(task: RemindTask): (string | number)[] {
  return [
    task.id,
    task.messageId || '',
    task.title,
    task.description || '',
    task.intervalDays,
    task.timeOfDay,
    task.remindBeforeMinutes,
    formatInventoryItems(task.inventoryItems),
    formatDateTime(task.startAt),
    formatDateTime(task.nextDueAt),
    task.lastDoneAt ? formatDateTime(task.lastDoneAt) : '',
    task.lastRemindDueAt ? formatDateTime(task.lastRemindDueAt) : '',
    task.overdueNotifyCount,
    task.overdueNotifyLimit ?? '',
    task.lastOverdueNotifiedAt ? formatDateTime(task.lastOverdueNotifiedAt) : '',
    task.isPaused ? '1' : '0',
    formatDateTime(task.createdAt),
    formatDateTime(task.updatedAt)
  ];
}

export function fromSheetRow(row: string[]): RemindTask {
  const hasInventoryColumn = row.length >= 18;
  const hasLimitColumn = hasInventoryColumn ? row.length >= 18 : row.length >= 17;
  const indexOffset = hasInventoryColumn ? 1 : 0;
  const startAtIndex = 7 + indexOffset;
  const nextDueAtIndex = 8 + indexOffset;
  const lastDoneAtIndex = 9 + indexOffset;
  const lastRemindDueAtIndex = 10 + indexOffset;
  const overdueNotifyCountIndex = 11 + indexOffset;
  const overdueNotifyLimitIndex = hasLimitColumn ? 12 + indexOffset : undefined;
  const lastOverdueIndex = hasLimitColumn ? 13 + indexOffset : 12 + indexOffset;
  const isPausedIndex = hasLimitColumn ? 14 + indexOffset : 13 + indexOffset;
  const createdAtIndex = hasLimitColumn ? 15 + indexOffset : 14 + indexOffset;
  const updatedAtIndex = hasLimitColumn ? 16 + indexOffset : 15 + indexOffset;

  return createRemindTask({
    id: row[0] || '',
    messageId: row[1] || undefined,
    title: row[2] || '',
    description: row[3] || undefined,
    intervalDays: parseNumber(row[4], 1),
    timeOfDay: row[5] || '00:00',
    remindBeforeMinutes: parseNumber(row[6], DEFAULT_REMIND_BEFORE_MINUTES),
    inventoryItems: hasInventoryColumn ? parseInventoryItems(row[7]) : [],
    startAt: parseDate(row[startAtIndex]) ?? new Date(),
    nextDueAt: parseDate(row[nextDueAtIndex]) ?? new Date(),
    lastDoneAt: parseDate(row[lastDoneAtIndex]),
    lastRemindDueAt: parseDate(row[lastRemindDueAtIndex]),
    overdueNotifyCount: parseNumber(row[overdueNotifyCountIndex], 0),
    overdueNotifyLimit: overdueNotifyLimitIndex !== undefined
      ? parseOptionalNumber(row[overdueNotifyLimitIndex])
      : undefined,
    lastOverdueNotifiedAt: parseDate(row[lastOverdueIndex]),
    isPaused: row[isPausedIndex] === '1',
    createdAt: parseDate(row[createdAtIndex]) ?? new Date(),
    updatedAt: parseDate(row[updatedAtIndex]) ?? new Date()
  });
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseDate(value: string | undefined): Date | null {
  if (!value || value.trim() === '') {
    return null;
  }

  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatDateTime(date: Date): string {
  const tokyoDate = new Date(date.getTime() + TOKYO_OFFSET_MINUTES * 60 * 1000);
  const year = tokyoDate.getUTCFullYear();
  const month = String(tokyoDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tokyoDate.getUTCDate()).padStart(2, '0');
  const hours = String(tokyoDate.getUTCHours()).padStart(2, '0');
  const minutes = String(tokyoDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(tokyoDate.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+09:00`;
}

function parseInventoryItems(value: string | undefined): RemindTask['inventoryItems'] {
  if (!value || value.trim() === '') {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(item => item && typeof item.name === 'string')
      .map(item => ({
        name: item.name,
        stock: Number(item.stock),
        consume: Number(item.consume)
      }))
      .filter(item =>
        item.name.trim() !== ''
        && Number.isFinite(item.stock)
        && Number.isFinite(item.consume)
      );
  } catch {
    return [];
  }
}

function formatInventoryItems(items: RemindTask['inventoryItems']): string {
  if (!items || items.length === 0) {
    return '';
  }
  return JSON.stringify(items);
}
