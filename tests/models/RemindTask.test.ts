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

  it('accepts decimal inventory values', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: '棚卸し',
      intervalDays: 1,
      timeOfDay: '10:00',
      remindBeforeMinutes: 0,
      inventoryItems: [{ inventoryId: '洗剤', consume: '0.5' }],
      startAt: new Date('2025-12-29T10:00:00+09:00'),
      nextDueAt: new Date('2025-12-30T10:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    expect(() => validateRemindTask(task)).not.toThrow();
  });

  it('rejects negative inventory consume', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: '棚卸し',
      intervalDays: 1,
      timeOfDay: '10:00',
      remindBeforeMinutes: 0,
      inventoryItems: [{ inventoryId: '洗剤', consume: '-1' }],
      startAt: new Date('2025-12-29T10:00:00+09:00'),
      nextDueAt: new Date('2025-12-30T10:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    expect(() => validateRemindTask(task)).toThrow();
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

describe('validateRemindTask inventory consume boundaries', () => {
  it.each([{ intervalDays: 1.5 }, { remindBeforeMinutes: 0.5 }])('rejects fractional scheduling fields %s', (fields) => {
    const now = new Date('2026-01-01T00:00:00Z');
    const task = createRemindTask({ id: 'task', title: '家事', intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 0,
      startAt: now, nextDueAt: now, createdAt: now, updatedAt: now, ...fields });
    expect(() => validateRemindTask(task)).toThrow();
  });
  it('consume === 0 の NewRemindInventoryItem が validateRemindTask を通過する（エラーを投げない）', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: '棚卸し',
      intervalDays: 1,
      timeOfDay: '10:00',
      remindBeforeMinutes: 0,
      inventoryItems: [{ inventoryId: 'inventory-1', consume: '0' }],
      startAt: new Date('2025-12-29T10:00:00+09:00'),
      nextDueAt: new Date('2025-12-30T10:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    expect(() => validateRemindTask(task)).not.toThrow();
  });

  it('consume < 0 の NewRemindInventoryItem は validateRemindTask でエラー: inventory_itemsの消費数が無効です を投げる', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: '棚卸し',
      intervalDays: 1,
      timeOfDay: '10:00',
      remindBeforeMinutes: 0,
      inventoryItems: [{ inventoryId: 'inventory-1', consume: '-1' }],
      startAt: new Date('2025-12-29T10:00:00+09:00'),
      nextDueAt: new Date('2025-12-30T10:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    expect(() => validateRemindTask(task)).toThrow();
  });
});
