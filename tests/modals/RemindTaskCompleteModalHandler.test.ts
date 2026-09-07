import { describe, it, expect, vi } from 'vitest';
import { RemindTaskCompleteModalHandler } from '../../src/modals/RemindTaskCompleteModalHandler';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { createRemindTask } from '../helpers/RemindTask';
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
    interaction: {
        customId: string;
        channelId: string;
        client: { channels: { fetch: ReturnType<typeof vi.fn> } };
        fields: {
            getTextInputValue: () => string;
        };
    };
    task: ReturnType<typeof createRemindTask>;
} {
  const now = new Date('2026-01-01T00:00:00Z');
  const task = createRemindTask({ id: 'task', revision: '7', messageId: '456', title: '米', intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 0, startAt: now, nextDueAt: now, createdAt: now, updatedAt: now, inventoryItems: [{ inventoryId: 'rice', consume: '0' }] });
  const db = { findTaskByMessageId: vi.fn().mockResolvedValue({ ...task, channelId: '123', position: 0, description: null, overdueNotifyLimit: null }), complete: vi.fn().mockResolvedValue({ ...task, revision: '8', channelId: '123', position: 0, description: null, overdueNotifyLimit: null }) };
  const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { linkedInventoryChannelId: '789' } }) };
  const handler = new ExposedHandler(new Logger(), undefined, metadata as any, new RemindTaskRepository(db as any));
  const interaction = { customId: `remind-task-complete-modal:456:${revision}`, channelId: '123', client: { channels: { fetch: vi.fn().mockRejectedValue(new Error('Discord unavailable')) } }, fields: { getTextInputValue: (): string => input } };
  return { handler, db, interaction, task };
}
describe('variable inventory completion through API', () => {
  it('completes once without waiting for task or inventory rendering', async () => {
    const x = setup();
    const result = await x.handler.execute({ interaction: x.interaction } as any);
    expect(x.db.complete).toHaveBeenCalledTimes(1);
    expect(x.interaction.client.channels.fetch).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
  it.each(['米,0.123', '米,0.264', '米,0', '米,'])('passes exact name and quantity input %s to the server without changing saved settings', async input => {
    const x = setup('7', input);
    const before = x.task.inventoryItems[0].consume;
    expect((await x.handler.execute({ interaction: x.interaction } as any)).success).toBe(true);
    expect(x.db.complete).toHaveBeenCalledWith('123', 'task', '7', [{ name: '米', consume: input.split(',')[1] || null }]);
    expect(x.task.inventoryItems[0].consume).toBe(before);
    expect(x.interaction.client.channels.fetch).not.toHaveBeenCalled();
  });
  it('passes the modal revision unchanged so the API can reject concurrent changes', async () => {
    const x = setup('6');
    x.db.complete.mockRejectedValue(new Error('タスクが変更されました'));
    expect((await x.handler.execute({ interaction: x.interaction } as any)).success).toBe(false);
    expect(x.db.complete).toHaveBeenCalledWith('123', 'task', '6', [{ name: '米', consume: '0.3' }]);
    expect(x.interaction.client.channels.fetch).not.toHaveBeenCalled();
  });
  it.each(['誤字,0', ''])('propagates domain rejection for %s without rendering success', async input => {
    const x = setup('7', input);
    x.db.complete.mockRejectedValue(new Error('入力内容を確認してください'));
    expect((await x.handler.execute({ interaction: x.interaction } as any)).success).toBe(false);
    expect(x.interaction.client.channels.fetch).not.toHaveBeenCalled();
  });
});
