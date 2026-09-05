import { describe, it, expect, vi } from 'vitest';
import { ListDueReminderScheduler } from '../../src/services/ListDueReminderScheduler';
describe('期限日通知DB', () => {
  it('東京日付の候補のみ送信後にID条件更新する', async () => {
    const repo = { notificationCandidates: vi.fn().mockResolvedValue([{ id: 'uuid', channelId: '1', name: '牛乳', until: '2026-01-01' }]), markNotified: vi.fn().mockResolvedValue(true) };
    const meta = { listChannelMetadata: vi.fn().mockResolvedValue([{ channelId: '1', listTitle: '買物', operationLogThreadId: '2' }]) };
    const send = vi.fn();
    const client = { channels: { fetch: vi.fn().mockResolvedValue({ send }) } };
    const now = new Date('2025-12-31T15:01:00Z');
    await new ListDueReminderScheduler(meta as any, repo as any).runOnce(client as any, now);
    expect(repo.notificationCandidates).toHaveBeenCalledWith({ date: '2026-01-01', start: new Date('2025-12-31T15:00:00Z'), end: new Date('2026-01-01T15:00:00Z') });
    expect(send).toHaveBeenCalledOnce();
    expect(repo.markNotified).toHaveBeenCalledWith('uuid', '2026-01-01', now);
  });
  it('Discord送信失敗時には通知済みにしない', async () => {
    const repo = { notificationCandidates: vi.fn().mockResolvedValue([{ id: 'uuid', channelId: '1', name: '牛乳', until: '2026-01-01' }]), markNotified: vi.fn() };
    const meta = { listChannelMetadata: vi.fn().mockResolvedValue([{ channelId: '1', operationLogThreadId: '2' }]) };
    await new ListDueReminderScheduler(meta as any, repo as any).runOnce({ channels: { fetch: vi.fn().mockResolvedValue({ send: vi.fn().mockRejectedValue(new Error('offline')) }) } } as any);
    expect(repo.markNotified).not.toHaveBeenCalled();
  });
});
