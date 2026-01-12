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
      listChannelMetadata: vi.fn().mockResolvedValue([{
        channelId: 'channel-1',
        messageId: '',
        listTitle: '',
        lastSyncTime: new Date(),
        remindNoticeThreadId: 'thread-1',
        remindNoticeMessageId: 'notice-msg-1'
      }])
    };
    const mockRepository = {
      fetchTasks: vi.fn().mockResolvedValue([task]),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true }),
      sendReminderToThread: vi.fn().mockResolvedValue({ success: true })
    };

    const mockClient = { channels: { fetch: vi.fn() } };

    const scheduler = new RemindScheduler(
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any
    );

    await scheduler.runOnce(mockClient as any, new Date('2026-01-05T08:30:00+09:00'));

    expect(mockMessageManager.sendReminderToThread).toHaveBeenCalledWith(
      'channel-1',
      'thread-1',
      'notice-msg-1',
      '@everyone 掃除の期限まであと1時間になりました。',
      mockClient
    );
    expect(mockRepository.updateTask).toHaveBeenCalled();
  });

  it('updates task message every hour when no reminder', async () => {
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
      listChannelMetadata: vi.fn().mockResolvedValue([{
        channelId: 'channel-1',
        messageId: '',
        listTitle: '',
        lastSyncTime: new Date(),
        remindNoticeThreadId: 'thread-1',
        remindNoticeMessageId: 'notice-msg-1'
      }])
    };
    const mockRepository = {
      fetchTasks: vi.fn().mockResolvedValue([task]),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true }),
      sendReminderToThread: vi.fn().mockResolvedValue({ success: true })
    };

    const mockClient = { channels: { fetch: vi.fn() } };

    const scheduler = new RemindScheduler(
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any
    );

    await scheduler.runOnce(mockClient as any, new Date('2026-01-04T00:00:00+09:00'));

    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalledWith(
      'channel-1',
      'msg-1',
      task,
      mockClient,
      expect.any(Date)
    );
    expect(mockMessageManager.sendReminderToThread).not.toHaveBeenCalled();
  });

  it('includes inventory shortage notice on pre-reminder when insufficient', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
      inventoryItems: [{ name: '牛乳', stock: 0, consume: 1 }],
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const mockMetadataManager = {
      listChannelMetadata: vi.fn().mockResolvedValue([{
        channelId: 'channel-1',
        messageId: '',
        listTitle: '',
        lastSyncTime: new Date(),
        remindNoticeThreadId: 'thread-1',
        remindNoticeMessageId: 'notice-msg-1'
      }]),
      updateChannelMetadata: vi.fn().mockResolvedValue({ success: true })
    };
    const mockRepository = {
      fetchTasks: vi.fn().mockResolvedValue([task]),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true }),
      sendReminderToThread: vi.fn().mockResolvedValue({ success: true })
    };

    const mockClient = { channels: { fetch: vi.fn() } };

    const scheduler = new RemindScheduler(
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any
    );

    await scheduler.runOnce(mockClient as any, new Date('2026-01-05T08:30:00+09:00'));

    const contents = mockMessageManager.sendReminderToThread.mock.calls.map((call: any[]) => call[3]);
    expect(contents.some((content: string) => content.includes('期限まであと1時間'))).toBe(true);
    expect(contents.some((content: string) => content.includes('牛乳の在庫が1個不足しています'))).toBe(true);
  });
});
