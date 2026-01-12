import { describe, it, expect } from 'vitest';
import { createRemindTask, validateRemindTask } from '../../src/models/RemindTask';

describe('RemindTask', () => {
  it('creates a remind task with defaults', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: '掃除機フィルター交換',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T08:00:00+09:00'),
      updatedAt: new Date('2025-12-29T08:00:00+09:00')
    });

    expect(task.id).toBe('task-1');
    expect(task.lastDoneAt).toBeNull();
    expect(task.overdueNotifyCount).toBe(0);
    expect(task.isPaused).toBe(false);
    expect(task.inventoryItems).toEqual([]);
  });

  it('validates required fields', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: '棚卸し',
      intervalDays: 1,
      timeOfDay: '10:00',
      remindBeforeMinutes: 0,
      startAt: new Date('2025-12-29T10:00:00+09:00'),
      nextDueAt: new Date('2025-12-30T10:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    expect(() => validateRemindTask(task)).not.toThrow();
  });

  it('throws when intervalDays is invalid', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: '棚卸し',
      intervalDays: 0,
      timeOfDay: '10:00',
      remindBeforeMinutes: 0,
      startAt: new Date('2025-12-29T10:00:00+09:00'),
      nextDueAt: new Date('2025-12-30T10:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    expect(() => validateRemindTask(task)).toThrow('interval_daysは1以上である必要があります');
  });
});
