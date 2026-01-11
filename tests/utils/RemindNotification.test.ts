import { describe, it, expect } from 'vitest';
import { createRemindTask } from '../../src/models/RemindTask';
import { shouldSendPreReminder, shouldSendOverdue } from '../../src/utils/RemindNotification';

describe('RemindNotification', () => {
  const baseTask = createRemindTask({
    id: 'task-1',
    title: 'フィルター交換',
    intervalDays: 7,
    timeOfDay: '09:00',
    remindBeforeMinutes: 60,
    startAt: new Date('2025-12-29T09:00:00+09:00'),
    nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
    createdAt: new Date('2025-12-29T09:00:00+09:00'),
    updatedAt: new Date('2025-12-29T09:00:00+09:00')
  });

  it('sends pre-reminder when within range and not notified', () => {
    const now = new Date('2026-01-05T08:30:00+09:00');
    expect(shouldSendPreReminder(baseTask, now)).toBe(true);
  });

  it('does not send pre-reminder when already notified for the due', () => {
    const now = new Date('2026-01-05T08:30:00+09:00');
    const task = { ...baseTask, lastRemindDueAt: baseTask.nextDueAt };
    expect(shouldSendPreReminder(task, now)).toBe(false);
  });

  it('does not send pre-reminder after due time', () => {
    const now = new Date('2026-01-05T10:00:00+09:00');
    expect(shouldSendPreReminder(baseTask, now)).toBe(false);
  });

  it('sends overdue reminder when overdue and count allows', () => {
    const now = new Date('2026-01-06T10:00:00+09:00');
    expect(shouldSendOverdue(baseTask, now)).toBe(true);
  });

  it('does not send overdue reminder when paused', () => {
    const now = new Date('2026-01-06T10:00:00+09:00');
    const task = { ...baseTask, isPaused: true };
    expect(shouldSendOverdue(task, now)).toBe(false);
  });

  it('does not send overdue reminder when already notified today', () => {
    const now = new Date('2026-01-06T10:00:00+09:00');
    const task = { ...baseTask, lastOverdueNotifiedAt: new Date('2026-01-06T00:30:00+09:00') };
    expect(shouldSendOverdue(task, now)).toBe(false);
  });

  it('does not send overdue reminder when count reached', () => {
    const now = new Date('2026-01-06T10:00:00+09:00');
    const task = { ...baseTask, overdueNotifyCount: 5, overdueNotifyLimit: 5 };
    expect(shouldSendOverdue(task, now)).toBe(false);
  });

  it('sends overdue reminder when limit is unset even if count is high', () => {
    const now = new Date('2026-01-06T10:00:00+09:00');
    const task = { ...baseTask, overdueNotifyCount: 99 };
    expect(shouldSendOverdue(task, now)).toBe(true);
  });
});
