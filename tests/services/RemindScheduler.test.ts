import { describe, it, expect, vi } from 'vitest';
import { RemindScheduler } from '../../src/services/RemindScheduler';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindScheduler', () => {
  it('sends pre-reminder and updates task', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '掃除',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const mockMetadataManager = {
      listChannelMetadata: vi.fn().mockResolvedValue([{ channelId: 'channel-1', messageId: '', listTitle: '', lastSyncTime: new Date() }])
    };
    const mockRepository = {
      fetchTasks: vi.fn().mockResolvedValue([task]),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };

    const mockChannel = { send: vi.fn().mockResolvedValue(undefined), isTextBased: (): boolean => true };
    const mockClient = { channels: { fetch: vi.fn().mockResolvedValue(mockChannel) } };

    const scheduler = new RemindScheduler(
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any
    );

    await scheduler.runOnce(mockClient as any, new Date('2026-01-05T08:30:00+09:00'));

    expect(mockChannel.send).toHaveBeenCalled();
    expect(mockRepository.updateTask).toHaveBeenCalled();
  });
});
