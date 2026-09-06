import { describe, expect, it, vi } from 'vitest';
import { NotificationScheduler } from '../../src/services/NotificationScheduler';
import type { Schema } from '../../src/api/contracts';
const task = { id: 'legacy', channelId: 'channel', revision: '1', messageId: 'message', title: 'task', inventoryItems: [], startAt: '2026-01-01T00:00:00.000Z', nextDueAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastDoneAt: null, lastRemindDueAt: null, lastOverdueNotifiedAt: null } as Schema['StoredRemindTask'];
const notification = { kind: 'overdue', channelId: 'channel', id: 'legacy', evaluatedAt: '2026-01-03T00:00:00.000Z', targetDueAt: task.nextDueAt, expectedRevision: '1', list: null, item: null, reminder: { channel: { channelId: 'channel', remindNoticeThreadId: 'thread', remindNoticeMessageId: 'parent' }, task, shortages: [] } } as Schema['Notification'];
function setup(): any {
  const api = { poll: vi.fn().mockResolvedValue({ notifications: [notification], progress: [] }), ack: vi.fn().mockResolvedValue({ task: { ...task, revision: '2' }, item: null }) };
  const messages = { sendReminderToThread: vi.fn().mockResolvedValue({ success: true, threadId: 'thread', parentMessageId: 'parent' }), updateTaskMessage: vi.fn().mockResolvedValue({ success: true }) };
  const metadata = { updateChannelMetadata: vi.fn().mockResolvedValue({ success: true }) };
  return { api, messages, metadata, scheduler: new NotificationScheduler(api, messages as any, metadata as any), client: {} as any };
}
describe('notification poll send ack', () => {
  it('uses the exact plan token and renders the revision returned by ack', async () => {
    const { scheduler, client, api, messages } = setup();
    await scheduler.runOnce(client);
    expect(api.ack).toHaveBeenCalledWith({ kind: 'overdue', channelId: 'channel', id: 'legacy', evaluatedAt: notification.evaluatedAt, targetDueAt: task.nextDueAt, expectedRevision: '1' });
    expect(messages.updateTaskMessage.mock.calls[0][2].revision).toBe('2');
  });
  it('does not ack unsuccessful Discord delivery', async () => {
    const { scheduler, client, api, messages } = setup();
    messages.sendReminderToThread.mockResolvedValue({ success: false } as any);
    await scheduler.runOnce(client);
    expect(api.ack).not.toHaveBeenCalled();
  });
  it('does not retry or render a conflicted ack', async () => {
    const { scheduler, client, api, messages } = setup();
    api.ack.mockRejectedValue(new Error('conflict'));
    await scheduler.runOnce(client);
    expect(api.ack).toHaveBeenCalledTimes(1);
    expect(messages.updateTaskMessage).not.toHaveBeenCalled();
  });
  it('saves newly created thread IDs before acknowledgement', async () => {
    const { scheduler, client, api, messages, metadata } = setup();
    const calls: string[] = [];
    messages.sendReminderToThread.mockResolvedValue({ success: true, threadId: 'new', parentMessageId: 'new-parent' });
    metadata.updateChannelMetadata.mockImplementation(async () => { calls.push('settings'); return { success: true }; });
    api.ack.mockImplementation(async () => { calls.push('ack'); return { task: null, item: null }; });
    await scheduler.runOnce(client);
    expect(calls).toEqual(['settings', 'ack']);
  });
  it('prevents overlapping ticks and never acknowledges progress rendering', async () => {
    const { scheduler, client, api, messages } = setup();
    let resolve!: (value: unknown) => void;
    api.poll.mockImplementation(() => new Promise(r => { resolve = r; }));
    const running = scheduler.runOnce(client);
    await scheduler.runOnce(client);
    expect(api.poll).toHaveBeenCalledTimes(1);
    resolve({ notifications: [], progress: [{ kind: 'progress', reminder: notification.reminder, evaluatedAt: notification.evaluatedAt }] });
    await running;
    expect(messages.updateTaskMessage).toHaveBeenCalledTimes(1);
    expect(api.ack).not.toHaveBeenCalled();
  });
  it('does not overwrite an acknowledged task with the old progress revision', async () => {
    const { scheduler, client, api, messages } = setup();
    api.poll.mockResolvedValue({ notifications: [notification], progress: [{ kind: 'progress', reminder: notification.reminder, evaluatedAt: notification.evaluatedAt }] });
    await scheduler.runOnce(client);
    expect(messages.updateTaskMessage).toHaveBeenCalledTimes(1);
    expect(messages.updateTaskMessage.mock.calls[0][2].revision).toBe('2');
  });
});
