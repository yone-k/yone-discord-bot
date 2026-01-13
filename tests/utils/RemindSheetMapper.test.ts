import { describe, it, expect } from 'vitest';
import { createRemindTask } from '../../src/models/RemindTask';
import { getRemindSheetHeaders, toSheetRow, fromSheetRow } from '../../src/utils/RemindSheetMapper';

describe('RemindSheetMapper', () => {
  it('returns remind sheet headers', () => {
    expect(getRemindSheetHeaders()).toEqual([
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
    ]);
  });

  it('converts task to sheet row', () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: 'フィルター交換',
      description: '月1回',
      intervalDays: 30,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      inventoryItems: [{ name: '牛乳', stock: 3, consume: 1 }],
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-28T09:00:00+09:00'),
      lastDoneAt: null,
      lastRemindDueAt: null,
      overdueNotifyCount: 0,
      overdueNotifyLimit: 3,
      lastOverdueNotifiedAt: null,
      isPaused: false,
      createdAt: new Date('2025-12-29T08:00:00+09:00'),
      updatedAt: new Date('2025-12-29T08:00:00+09:00')
    });

    const row = toSheetRow(task);
    expect(row[0]).toBe('task-1');
    expect(row[4]).toBe(30);
    expect(row[7]).toBe('[{"name":"牛乳","stock":3,"consume":1}]');
    expect(row[8]).toBe('2025-12-29T09:00:00+09:00');
    expect(row[13]).toBe(3);
    expect(row[17]).toBe('2025-12-29T08:00:00+09:00');
  });

  it('converts task to sheet row with decimals', () => {
    const task = createRemindTask({
      id: 'task-2',
      messageId: 'msg-2',
      title: '洗剤補充',
      description: '隔週',
      intervalDays: 14,
      timeOfDay: '08:30',
      remindBeforeMinutes: 60,
      inventoryItems: [{ name: '洗剤', stock: 1.5, consume: 0.5 }],
      startAt: new Date('2025-12-29T08:30:00+09:00'),
      nextDueAt: new Date('2026-01-12T08:30:00+09:00'),
      lastDoneAt: null,
      lastRemindDueAt: null,
      overdueNotifyCount: 0,
      overdueNotifyLimit: 3,
      lastOverdueNotifiedAt: null,
      isPaused: false,
      createdAt: new Date('2025-12-29T08:00:00+09:00'),
      updatedAt: new Date('2025-12-29T08:00:00+09:00')
    });

    const row = toSheetRow(task);
    expect(row[7]).toBe('[{"name":"洗剤","stock":1.5,"consume":0.5}]');
  });

  it('converts sheet row to task', () => {
    const row = [
      'task-1',
      'msg-1',
      'フィルター交換',
      '月1回',
      '30',
      '09:00',
      '1440',
      '[{"name":"牛乳","stock":2,"consume":1}]',
      '2025-12-29T09:00:00+09:00',
      '2026-01-28T09:00:00+09:00',
      '',
      '',
      '0',
      '2',
      '',
      '0',
      '2025-12-29T08:00:00+09:00',
      '2025-12-29T08:00:00+09:00'
    ];

    const task = fromSheetRow(row);
    expect(task.id).toBe('task-1');
    expect(task.intervalDays).toBe(30);
    expect(task.lastDoneAt).toBeNull();
    expect(task.isPaused).toBe(false);
    expect(task.overdueNotifyLimit).toBe(2);
    expect(task.inventoryItems).toEqual([{ name: '牛乳', stock: 2, consume: 1 }]);
    expect(task.nextDueAt.toISOString()).toBe('2026-01-28T00:00:00.000Z');
  });

  it('rounds decimals when converting sheet row to task', () => {
    const row = [
      'task-3',
      'msg-3',
      '洗剤補充',
      '隔週',
      '14',
      '08:30',
      '60',
      '[{"name":"洗剤","stock":1.05,"consume":0.55}]',
      '2025-12-29T08:30:00+09:00',
      '2026-01-12T08:30:00+09:00',
      '',
      '',
      '0',
      '2',
      '',
      '0',
      '2025-12-29T08:00:00+09:00',
      '2025-12-29T08:00:00+09:00'
    ];

    const task = fromSheetRow(row);
    expect(task.inventoryItems).toEqual([{ name: '洗剤', stock: 1.1, consume: 0.6 }]);
  });
});
