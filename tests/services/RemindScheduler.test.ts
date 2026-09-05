import { describe, it, expect, vi } from 'vitest';
import { RemindScheduler } from '../../src/services/RemindScheduler';
import { createRemindTask } from '../../src/models/RemindTask';
import { LoggerManager } from '../../src/utils/LoggerManager';
function setup(kind: 'before' | 'overdue' = 'before'): {
    scheduler: RemindScheduler;
    repository: {
        notificationCandidates: ReturnType<typeof vi.fn>;
        activeTasks: ReturnType<typeof vi.fn>;
        markNotified: ReturnType<typeof vi.fn>;
    };
    messages: {
        sendReminderToThread: ReturnType<typeof vi.fn>;
        updateTaskMessage: ReturnType<typeof vi.fn>;
    };
    now: Date;
    task: ReturnType<typeof createRemindTask>;
} {
  const now = new Date('2026-01-01T00:00:00Z');
  const task = createRemindTask({ id: 'task', revision: '7', messageId: '456', title: '米', intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 60, startAt: new Date('2025-12-30T00:00:00Z'), nextDueAt: new Date(kind === 'before' ? '2026-01-01T00:30:00Z' : '2025-12-31T00:00:00Z'), createdAt: now, updatedAt: now });
  const channels = { listChannelMetadata: vi.fn().mockResolvedValue([{ channelId: '123', remindNoticeThreadId: '789', remindNoticeMessageId: '987' }]) };
  const repository = { notificationCandidates: vi.fn().mockResolvedValue([task]), activeTasks: vi.fn().mockResolvedValue([task]), markNotified: vi.fn().mockResolvedValue(true) };
  const messages = { sendReminderToThread: vi.fn().mockResolvedValue({ success: true }), updateTaskMessage: vi.fn().mockResolvedValue({ success: true }) };
  const inventory = { checkShortageForTask: vi.fn().mockResolvedValue({ kind: 'success' }) };
  return { scheduler: new RemindScheduler(channels as any, repository as any, messages as any, inventory), repository, messages, now, task };
}
describe('database reminder scheduler', () => {
  it.each(['before', 'overdue'] as const)('records %s notification conflicts with task identity', async kind => {
    const warn = vi.spyOn(LoggerManager.getLogger('RemindScheduler'), 'warn').mockImplementation(() => undefined);
    try {
      const x = setup(kind);
      x.repository.markNotified.mockResolvedValue(false);
      await x.scheduler.runOnce({} as any, x.now);
      expect(warn).toHaveBeenCalledWith('Reminder notification state conflicted', expect.objectContaining({ channelId: '123', taskId: 'task', revision: '7', kind }));
    } finally { warn.mockRestore(); }
  });
  it('records a failed DB write after notification with task identity', async () => {
    const error = vi.spyOn(LoggerManager.getLogger('RemindScheduler'), 'error').mockImplementation(() => undefined);
    try {
      const x = setup();
      x.repository.markNotified.mockRejectedValue(new Error('DB unavailable'));
      await expect(x.scheduler.runOnce({} as any, x.now)).rejects.toThrow('DB unavailable');
      expect(error).toHaveBeenCalledWith('Reminder notification state save failed', expect.objectContaining({ channelId: '123', taskId: 'task', revision: '7', kind: 'before' }));
    } finally { error.mockRestore(); }
  });
  it('records periodic processing failures', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(LoggerManager.getLogger('RemindScheduler'), 'error').mockImplementation(() => undefined);
    const x = setup();
    try {
      x.repository.notificationCandidates.mockRejectedValue(new Error('DB offline'));
      x.scheduler.start({} as any);
      await vi.advanceTimersByTimeAsync(60000);
      expect(error).toHaveBeenCalledWith('Reminder scheduler failed', { error: 'DB offline' });
    } finally { x.scheduler.stop(); error.mockRestore(); vi.useRealTimers(); }
  });
  it('stops its polling timer during shutdown', async () => {
    vi.useFakeTimers();
    try {
      const x = setup();
      x.scheduler.start({} as any);
      x.scheduler.stop();
      await vi.advanceTimersByTimeAsync(120000);
      expect(x.repository.notificationCandidates).not.toHaveBeenCalled();
    }
    finally {
      vi.useRealTimers();
    }
  });
  it.each(['before', 'overdue'] as const)('marks %s only after Discord success with fetched revision', async (kind) => {
    const x = setup(kind);
    await x.scheduler.runOnce({} as any, x.now);
    expect(x.repository.markNotified).toHaveBeenCalledWith('123', x.task, kind, x.now);
    expect(x.messages.sendReminderToThread.mock.invocationCallOrder[0]).toBeLessThan(x.repository.markNotified.mock.invocationCallOrder[0]);
  });
  it('does not mark failed Discord sends', async () => {
    const x = setup();
    x.messages.sendReminderToThread.mockResolvedValue({ success: false });
    await x.scheduler.runOnce({} as any, x.now);
    expect(x.repository.markNotified).not.toHaveBeenCalled();
  });
  it('does not overwrite a newer task after a conditional notification conflict', async () => {
    const x = setup();
    x.repository.markNotified.mockResolvedValue(false);
    await x.scheduler.runOnce({} as any, x.now);
    expect(x.messages.updateTaskMessage).not.toHaveBeenCalled();
  });
  it('passes JST date bounds to candidate query and combines hourly display rows without duplication', async () => {
    const x = setup();
    await x.scheduler.runOnce({} as any, x.now);
    expect(x.repository.notificationCandidates).toHaveBeenCalledWith('123', x.now, { date: '2026-01-01', start: new Date('2025-12-31T15:00:00Z'), end: new Date('2026-01-01T15:00:00Z') });
    expect(x.messages.sendReminderToThread).toHaveBeenCalledTimes(1);
  });
});
