import { describe, it, expect, vi } from 'vitest';
import { RemindTaskCompleteButtonHandler } from '../../src/buttons/RemindTaskCompleteButtonHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskCompleteButtonHandler', () => {
  it('completes task and updates message', async () => {
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

    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };

    const handler = new RemindTaskCompleteButtonHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any
    );
    const interaction = {
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      deferReply: vi.fn(),
      deleteReply: vi.fn(),
      editReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockRepository.updateTask).toHaveBeenCalled();
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalled();
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(interaction.deleteReply).toHaveBeenCalled();
  });

  it('blocks completion when inventory is insufficient', async () => {
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

    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true }),
      sendReminderToThread: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { remindNoticeThreadId: 'thread-1', remindNoticeMessageId: 'notice-msg-1' }
      })
    };

    const handler = new RemindTaskCompleteButtonHandler(
      new Logger(),
      undefined,
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any
    );
    const interaction = {
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      deferReply: vi.fn(),
      deleteReply: vi.fn(),
      editReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockRepository.updateTask).not.toHaveBeenCalled();
    expect(mockMessageManager.updateTaskMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('在庫が不足しています')
    }));
  });

  it('notifies when inventory is insufficient before completion', async () => {
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

    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true }),
      sendReminderToThread: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { remindNoticeThreadId: 'thread-1', remindNoticeMessageId: 'notice-msg-1' }
      })
    };

    const handler = new RemindTaskCompleteButtonHandler(
      new Logger(),
      undefined,
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any
    );
    const interaction = {
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      deferReply: vi.fn(),
      deleteReply: vi.fn(),
      editReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockMessageManager.sendReminderToThread).toHaveBeenCalledWith(
      'channel-1',
      'thread-1',
      'notice-msg-1',
      '@everyone 補充チェックに使用する在庫品の在庫が切れました',
      interaction.client
    );
  });
});
