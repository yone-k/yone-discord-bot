import { describe, it, expect, vi } from 'vitest';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { InventoryRepository } from '../../src/services/InventoryRepository';
import { createRemindTask } from '../helpers/RemindTask';
import type { InventoryRepository as InventoryPort, RemindTaskRepository as TaskPort } from '../../src/api/contracts';

describe('database domain adapters', () => {
  it('passes exact inventory decimals and null default category to the database', async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const repository = new InventoryRepository({ append } as unknown as InventoryPort);
    await repository.append('123', { name: '米', stock: '9007199254740993.123', category: '' });
    expect(append).toHaveBeenCalledWith('123', { name: '米', stock: '9007199254740993.123', category: null });
  });
  it('completes task and consumes inventory with one database operation, preserving saved consumption', async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    const updateTask = vi.fn();
    const repository = new RemindTaskRepository({ complete, updateTask } as unknown as TaskPort);
    const now = new Date('2026-01-01T00:00:00Z');

    const task = createRemindTask({ id: 'task', revision: '7', title: '米', intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 0,
      startAt: now, nextDueAt: now, createdAt: now, updatedAt: now, inventoryItems: [{ inventoryId: 'rice', consume: '0' }] });
    complete.mockResolvedValue({ ...task, description: null, messageId: null, overdueNotifyLimit: null });
    await repository.complete('123', task, [{ name: '米', consume: '0.3' }]);
    expect(complete).toHaveBeenCalledWith('123', 'task', '7', [{ name: '米', consume: '0.3' }]);
    expect(updateTask).not.toHaveBeenCalled();
    expect(task.inventoryItems[0].consume).toBe('0');
  });
});
