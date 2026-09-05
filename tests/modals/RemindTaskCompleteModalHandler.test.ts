import { describe, it, expect, vi } from 'vitest';
import { RemindTaskCompleteModalHandler } from '../../src/modals/RemindTaskCompleteModalHandler';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { createRemindTask } from '../../src/models/RemindTask';
import { Logger } from '../../src/utils/logger';
class ExposedHandler extends RemindTaskCompleteModalHandler {
  execute = this.executeAction.bind(this);
}
function setup(revision = '7', input = '米,0.3'): {
    handler: ExposedHandler;
    db: {
        findTaskByMessageId: ReturnType<typeof vi.fn>;
        complete: ReturnType<typeof vi.fn>;
    };
    messages: {
        updateTaskMessage: ReturnType<typeof vi.fn>;
    };
    interaction: {
        customId: string;
        channelId: string;
        client: object;
        fields: {
            getTextInputValue: () => string;
        };
    };
    task: ReturnType<typeof createRemindTask>;
} {
  const now = new Date('2026-01-01T00:00:00Z');
  const task = createRemindTask({ id: 'task', revision: '7', messageId: '456', title: '米', intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 0, startAt: now, nextDueAt: now, createdAt: now, updatedAt: now, inventoryItems: [{ inventoryId: 'rice', consume: '0' }] });
  const db = { findTaskByMessageId: vi.fn().mockResolvedValue({ ...task, channelId: '123', position: 0, description: null, overdueNotifyLimit: null }), complete: vi.fn().mockResolvedValue(undefined) };
  const messages = { updateTaskMessage: vi.fn().mockResolvedValue({ success: true }) };
  const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { linkedInventoryChannelId: '789' } }) };
  const handler = new ExposedHandler(new Logger(), undefined, metadata as any, new RemindTaskRepository(db as any), messages as any, { fetchAll: vi.fn().mockResolvedValue([{ id: 'rice', name: '米', stock: '1', category: '' }]) }, { createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true }) }, { refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined) });
  const interaction = { customId: `remind-task-complete-modal:456:${revision}`, channelId: '123', client: {}, fields: { getTextInputValue: (): string => input } };
  return { handler, db, messages, interaction, task };
}
describe('variable inventory completion', () => {
  it('rejects unmatched input names instead of silently consuming the original fixed quantity', async () => {
    const x = setup('7', '誤字,0');
    x.task.inventoryItems[0].consume = '0.123';
    expect((await x.handler.execute({ interaction: x.interaction } as any)).success).toBe(false);
    expect(x.db.complete).not.toHaveBeenCalled();
    expect(x.messages.updateTaskMessage).not.toHaveBeenCalled();
  });
  it('preserves unedited high precision fixed consumption', async () => {
    const x = setup('7', '米,0.123');
    x.task.inventoryItems[0].consume = '0.123';
    await x.handler.execute({ interaction: x.interaction } as any);
    expect(x.db.complete.mock.calls[0][5]).toEqual([{ inventoryId: 'rice', consume: '0.123' }]);
  });
  it('normalizes edited fixed consumption without changing its stored setting', async () => {
    const x = setup('7', '米,0.264');
    x.task.inventoryItems[0].consume = '0.0123';
    await x.handler.execute({ interaction: x.interaction } as any);
    expect(x.db.complete.mock.calls[0][5]).toEqual([{ inventoryId: 'rice', consume: '0.3' }]);
    expect(x.task.inventoryItems[0].consume).toBe('0.0123');
  });
  it('applies explicit zero once without changing a positive stored consume', async () => {
    const x = setup('7', '米,0');
    x.task.inventoryItems[0].consume = '0.123';
    expect((await x.handler.execute({ interaction: x.interaction } as any)).success).toBe(true);
    expect(x.db.complete.mock.calls[0][5]).toEqual([{ inventoryId: 'rice', consume: '0' }]);
    expect(x.task.inventoryItems[0].consume).toBe('0.123');
  });
  it('retains the fixed quantity when its input is blank', async () => {
    const x = setup('7', '米,');
    x.task.inventoryItems[0].consume = '0.123';
    expect((await x.handler.execute({ interaction: x.interaction } as any)).success).toBe(true);
    expect(x.db.complete.mock.calls[0][5]).toEqual([{ inventoryId: 'rice', consume: '0.123' }]);
  });
  it('uses exact temporary consumption without replacing saved zero', async () => {
    const x = setup();
    expect((await x.handler.execute({ interaction: x.interaction } as any)).success).toBe(true);
    expect(x.db.complete).toHaveBeenCalledWith('123', 'task', '7', expect.any(Date), expect.any(Date), [{ inventoryId: 'rice', consume: '0.3' }]);
    expect(x.task.inventoryItems[0].consume).toBe('0');
  });
  it('rejects stale modal without writing', async () => {
    const x = setup('6');
    expect((await x.handler.execute({ interaction: x.interaction } as any)).success).toBe(false);
    expect(x.db.complete).not.toHaveBeenCalled();
  });
  it('requires a quantity when variable input is empty', async () => {
    const x = setup('7', '');
    expect((await x.handler.execute({ interaction: x.interaction } as any)).success).toBe(false);
    expect(x.db.complete).not.toHaveBeenCalled();
  });
  it('does not render success after a transaction failure', async () => {
    const x = setup();
    x.db.complete.mockRejectedValue(new Error('shortage'));
    expect((await x.handler.execute({ interaction: x.interaction } as any)).success).toBe(false);
    expect(x.messages.updateTaskMessage).not.toHaveBeenCalled();
  });
});
