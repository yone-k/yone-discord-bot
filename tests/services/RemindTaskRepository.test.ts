import { describe, it, expect, vi } from 'vitest';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { createRemindTask } from '../helpers/RemindTask';
import type { RemindTaskRepository as Port } from '../../src/api/contracts';
describe('RemindTaskRepository', () => {
  it('preserves channel identity when adapting inventory JOIN results', async () => {
    const db = { referencingInventory: vi.fn().mockResolvedValue([{ channelId: '123', title: 'Task', messageId: null, description: null, overdueNotifyLimit: null }]) };
    const tasks = await new RemindTaskRepository(db as unknown as Port).referencingInventory('456', 'item');
    expect(db.referencingInventory).toHaveBeenCalledWith('456', 'item');
    expect(tasks[0]).toMatchObject({ channelId: '123', title: 'Task', messageId: undefined });
  });
  it('keeps loaded revision and decimal quantities', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const task = { ...createRemindTask({ id: 'x', revision: '99', title: '米', intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 0, startAt: now, nextDueAt: now, createdAt: now, updatedAt: now }), channelId: '123', position: 0, messageId: null, description: null, overdueNotifyLimit: null, inventoryItems: [{ inventoryId: 'i', consume: '0.1234567890123456789' }] };
    const db = { fetchTasks: vi.fn().mockResolvedValue([task]) };
    const [loaded] = await new RemindTaskRepository(db as unknown as Port).fetchTasks('123');
    expect(loaded.revision).toBe('99');
    expect(loaded.inventoryItems[0].consume).toBe('0.1234567890123456789');
  });
});
