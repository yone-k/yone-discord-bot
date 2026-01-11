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
  const hasLimitColumn = row.length >= 17;
  const lastOverdueIndex = hasLimitColumn ? 13 : 12;
  const isPausedIndex = hasLimitColumn ? 14 : 13;
  const createdAtIndex = hasLimitColumn ? 15 : 14;
  const updatedAtIndex = hasLimitColumn ? 16 : 15;

  return createRemindTask({
    id: row[0] || '',
    messageId: row[1] || undefined,
    title: row[2] || '',
    description: row[3] || undefined,
    intervalDays: parseNumber(row[4], 1),
    timeOfDay: row[5] || '00:00',
    remindBeforeMinutes: parseNumber(row[6], DEFAULT_REMIND_BEFORE_MINUTES),
    startAt: parseDate(row[7]) ?? new Date(),
    nextDueAt: parseDate(row[8]) ?? new Date(),
    lastDoneAt: parseDate(row[9]),
    lastRemindDueAt: parseDate(row[10]),
    overdueNotifyCount: parseNumber(row[11], 0),
    overdueNotifyLimit: hasLimitColumn ? parseOptionalNumber(row[12]) : undefined,
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
