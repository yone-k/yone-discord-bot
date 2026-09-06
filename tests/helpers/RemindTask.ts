import type { RemindTask } from '../../src/models/RemindTask';

type RemindTaskInput = Pick<RemindTask,
  'id' | 'title' | 'intervalDays' | 'timeOfDay' | 'remindBeforeMinutes' |
  'startAt' | 'nextDueAt' | 'createdAt' | 'updatedAt'> & Partial<RemindTask>;

export function createRemindTask(input: RemindTaskInput): RemindTask {
  return {
    id: input.id.trim(),
    revision: input.revision ?? '0',
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
