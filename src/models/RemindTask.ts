export interface RemindTaskInput {
  id: string;
  messageId?: string;
  title: string;
  description?: string;
  intervalDays: number;
  timeOfDay: string;
  remindBeforeMinutes: number;
  inventoryItems?: RemindInventoryItem[];
  startAt: Date;
  nextDueAt: Date;
  lastDoneAt?: Date | null;
  lastRemindDueAt?: Date | null;
  overdueNotifyCount?: number;
  overdueNotifyLimit?: number;
  lastOverdueNotifiedAt?: Date | null;
  isPaused?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RemindInventoryItem {
  name: string;
  stock: number;
  consume: number;
}

export interface RemindTask {
  id: string;
  messageId?: string;
  title: string;
  description?: string;
  intervalDays: number;
  timeOfDay: string;
  remindBeforeMinutes: number;
  inventoryItems: RemindInventoryItem[];
  startAt: Date;
  nextDueAt: Date;
  lastDoneAt: Date | null;
  lastRemindDueAt: Date | null;
  overdueNotifyCount: number;
  overdueNotifyLimit?: number;
  lastOverdueNotifiedAt: Date | null;
  isPaused: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function createRemindTask(input: RemindTaskInput): RemindTask {
  return {
    id: input.id.trim(),
    messageId: input.messageId,
    title: input.title.trim(),
    description: input.description?.trim(),
    intervalDays: input.intervalDays,
    timeOfDay: input.timeOfDay,
    remindBeforeMinutes: input.remindBeforeMinutes,
    inventoryItems: input.inventoryItems ?? [],
    startAt: input.startAt,
    nextDueAt: input.nextDueAt,
    lastDoneAt: input.lastDoneAt ?? null,
    lastRemindDueAt: input.lastRemindDueAt ?? null,
    overdueNotifyCount: input.overdueNotifyCount ?? 0,
    overdueNotifyLimit: input.overdueNotifyLimit,
    lastOverdueNotifiedAt: input.lastOverdueNotifiedAt ?? null,
    isPaused: input.isPaused ?? false,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export function validateRemindTask(task: RemindTask): void {
  if (!task.id || task.id.trim() === '') {
    throw new Error('idは必須です');
  }

  if (!task.title || task.title.trim() === '') {
    throw new Error('タイトルは必須です');
  }

  if (task.intervalDays < 1) {
    throw new Error('interval_daysは1以上である必要があります');
  }

  if (!/^([0-9]|1\d|2[0-3]):([0-9]|[0-5]\d)$/.test(task.timeOfDay)) {
    throw new Error('time_of_dayの形式が無効です');
  }

  if (task.remindBeforeMinutes < 0 || task.remindBeforeMinutes > 10080) {
    throw new Error('remind_before_minutesの範囲が無効です');
  }

  if (!Array.isArray(task.inventoryItems)) {
    throw new Error('inventory_itemsが無効です');
  }

  for (const item of task.inventoryItems) {
    if (!item.name || item.name.trim() === '') {
      throw new Error('inventory_itemsの名称が無効です');
    }
    if (!Number.isFinite(item.stock) || item.stock < 0) {
      throw new Error('inventory_itemsの在庫数が無効です');
    }
    if (!Number.isFinite(item.consume) || item.consume <= 0) {
      throw new Error('inventory_itemsの消費数が無効です');
    }
  }

  if (!(task.startAt instanceof Date) || isNaN(task.startAt.getTime())) {
    throw new Error('start_atが無効です');
  }

  if (!(task.nextDueAt instanceof Date) || isNaN(task.nextDueAt.getTime())) {
    throw new Error('next_due_atが無効です');
  }

  if (task.lastDoneAt !== null && (!(task.lastDoneAt instanceof Date) || isNaN(task.lastDoneAt.getTime()))) {
    throw new Error('last_done_atが無効です');
  }

  if (task.lastRemindDueAt !== null && (!(task.lastRemindDueAt instanceof Date) || isNaN(task.lastRemindDueAt.getTime()))) {
    throw new Error('last_remind_due_atが無効です');
  }

  if (task.lastOverdueNotifiedAt !== null && (!(task.lastOverdueNotifiedAt instanceof Date) || isNaN(task.lastOverdueNotifiedAt.getTime()))) {
    throw new Error('last_overdue_notified_atが無効です');
  }

  if (task.overdueNotifyCount < 0) {
    throw new Error('overdue_notify_countが無効です');
  }

  if (task.overdueNotifyLimit !== undefined) {
    if (!Number.isInteger(task.overdueNotifyLimit) || task.overdueNotifyLimit < 0) {
      throw new Error('overdue_notify_limitが無効です');
    }
  }

  if (typeof task.isPaused !== 'boolean') {
    throw new Error('is_pausedが無効です');
  }

  if (!(task.createdAt instanceof Date) || isNaN(task.createdAt.getTime())) {
    throw new Error('created_atが無効です');
  }

  if (!(task.updatedAt instanceof Date) || isNaN(task.updatedAt.getTime())) {
    throw new Error('updated_atが無効です');
  }
}
