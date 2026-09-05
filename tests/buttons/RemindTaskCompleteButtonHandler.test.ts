import { describe, it, expect, vi } from 'vitest';
import { RemindTaskCompleteButtonHandler } from '../../src/buttons/RemindTaskCompleteButtonHandler';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { createRemindTask } from '../../src/models/RemindTask';
import { Logger } from '../../src/utils/logger';
import { parseCompletionInput } from '../../src/utils/RemindInventory';
const now = new Date('2026-01-01T00:00:00Z');
const task = (): ReturnType<typeof createRemindTask> => createRemindTask({ id: 'task', revision: '7', messageId: '456', title: '米', intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 0, startAt: now, nextDueAt: now, createdAt: now, updatedAt: now, inventoryItems: [{ inventoryId: 'rice', consume: '0.3' }] });
function setup(consume = '0.3', inventoryName = '米'): {
    handler: RemindTaskCompleteButtonHandler;
    db: {
        findTaskByMessageId: ReturnType<typeof vi.fn>;
        complete: ReturnType<typeof vi.fn>;
    };
    messages: {
        updateTaskMessage: ReturnType<typeof vi.fn>;
    };
    interaction: {
        customId: string;
        user: {
            id: string;
            bot: boolean;
        };
        channelId: string;
        message: {
            id: string;
        };
        client: object;
        deferReply: ReturnType<typeof vi.fn>;
        editReply: ReturnType<typeof vi.fn>;
        deleteReply: ReturnType<typeof vi.fn>;
        reply: ReturnType<typeof vi.fn>;
        showModal: ReturnType<typeof vi.fn>;
    };
} {
  const t = task();
  t.inventoryItems[0].consume = consume;
  const db = { findTaskByMessageId: vi.fn().mockResolvedValue({ ...t, channelId: '123', position: 0, description: null, overdueNotifyLimit: null }), complete: vi.fn().mockResolvedValue(undefined) };
  const repository = new RemindTaskRepository(db as any);
  const messages = { updateTaskMessage: vi.fn().mockResolvedValue({ success: true }) };
  const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { linkedInventoryChannelId: '789' } }) };
  const handler = new RemindTaskCompleteButtonHandler(new Logger(), undefined, metadata as any, repository, messages as any, { fetchAll: vi.fn().mockResolvedValue([{ id: 'rice', name: inventoryName, stock: '1', category: '' }]) }, { createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true }) }, { refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined) });
  const interaction = { customId: 'remind-task-complete', user: { id: 'u', bot: false }, channelId: '123', message: { id: '456' }, client: {}, deferReply: vi.fn(), editReply: vi.fn(), deleteReply: vi.fn(), reply: vi.fn(), showModal: vi.fn() };
  return { handler, db, messages, interaction };
}
describe('task completion from Discord button through domain adapter', () => {
  it.each([' milk ', 'a,b', 'a"b', 'a\nb', 'a;b'])('prefills exact CSV completion name %j', async name => {
    const x = setup('0', name);
    await x.handler.handle({ interaction: x.interaction } as any);
    const input = x.interaction.showModal.mock.calls[0][0].toJSON().components[0].components[0].value;
    expect(parseCompletionInput(input)).toEqual([{ name, consume: null }]);
    const field = x.interaction.showModal.mock.calls[0][0].toJSON().components[0].components[0];
    expect(field.label).toContain('都度入力必須');
    expect(field.label).toContain('固定は空欄で維持');
    expect(field.placeholder).toContain('消費しない場合は0');
  });
  it('atomically completes before updating Discord', async () => {
    const x = setup();
    await x.handler.handle({ interaction: x.interaction } as any);
    expect(x.db.complete).toHaveBeenCalledWith('123', 'task', '7', expect.any(Date), expect.any(Date), undefined);
    expect(x.messages.updateTaskMessage).toHaveBeenCalled();
    expect(x.db.complete.mock.invocationCallOrder[0]).toBeLessThan(x.messages.updateTaskMessage.mock.invocationCallOrder[0]);
  });
  it.each(['在庫不足', 'タスクが変更されました'])('does not render completion when DB rejects: %s', async (message) => {
    const x = setup();
    x.db.complete.mockRejectedValue(new Error(message));
    await x.handler.handle({ interaction: x.interaction } as any);
    expect(x.messages.updateTaskMessage).not.toHaveBeenCalled();
    expect(x.interaction.editReply).toHaveBeenCalledWith({ content: message });
  });
  it('opens variable-consumption modal with current revision without any write', async () => {
    const x = setup('0');
    await x.handler.handle({ interaction: x.interaction } as any);
    expect(x.db.complete).not.toHaveBeenCalled();
    expect(x.interaction.showModal.mock.calls[0][0].toJSON().custom_id).toBe('remind-task-complete-modal:456:7');
  });
});
