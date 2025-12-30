import { describe, it, expect, vi } from 'vitest';
import { RemindTaskUpdateModalHandler } from '../../src/modals/RemindTaskUpdateModalHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskUpdateModalHandler', () => {
  it('updates task from modal input', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '掃除',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
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

    const handler = new RemindTaskUpdateModalHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any
    );

    const interaction = {
      customId: 'remind-task-update-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: {
        getTextInputValue: vi.fn((key: string) => {
          if (key === 'title') return '掃除';
          if (key === 'description') return '';
          if (key === 'interval-days') return '7';
          if (key === 'time-of-day') return '09:00';
          if (key === 'remind-before') return '1440';
          return '';
        })
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockRepository.updateTask).toHaveBeenCalled();
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalled();
  });
});
