import { describe, it, expect, vi } from 'vitest';
import { RemindTaskUpdateOverrideModalHandler } from '../../src/modals/RemindTaskUpdateOverrideModalHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskUpdateOverrideModalHandler', () => {
  it('overrides last done, next due, and limit using modal input', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '掃除',
      intervalDays: 10,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-11-01T09:00:00+09:00'),
      lastDoneAt: new Date('2025-11-10T09:00:00+09:00'),
      nextDueAt: new Date('2025-11-20T09:00:00+09:00'),
      createdAt: new Date('2025-11-01T09:00:00+09:00'),
      updatedAt: new Date('2025-11-01T09:00:00+09:00')
    });

    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };

    const handler = new RemindTaskUpdateOverrideModalHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any
    );

    const interaction = {
      customId: 'remind-task-update-override-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: {
        getTextInputValue: vi.fn((key: string) => {
          if (key === 'last-done-at') return '2025/12/01';
          if (key === 'next-due-at') return '2026/01/01';
          if (key === 'overdue-notify-limit') return '2';
          return '';
        })
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockRepository.updateTask).toHaveBeenCalled();
    const updatedTask = mockRepository.updateTask.mock.calls[0][1];
    const expectedLastDoneAt = new Date('2025-12-01T09:00:00+09:00');
    const expectedNextDueAt = new Date('2026-01-01T09:00:00+09:00');
    expect(updatedTask.lastDoneAt?.getTime()).toBe(expectedLastDoneAt.getTime());
    expect(updatedTask.nextDueAt.getTime()).toBe(expectedNextDueAt.getTime());
    expect(updatedTask.overdueNotifyLimit).toBe(2);
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalled();
  });

  it('updates limit without resetting counts when dates are unchanged', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '掃除',
      intervalDays: 10,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-11-01T09:00:00+09:00'),
      lastDoneAt: new Date('2025-11-10T09:00:00+09:00'),
      nextDueAt: new Date('2025-11-20T09:00:00+09:00'),
      overdueNotifyCount: 3,
      lastOverdueNotifiedAt: new Date('2025-11-21T09:00:00+09:00'),
      createdAt: new Date('2025-11-01T09:00:00+09:00'),
      updatedAt: new Date('2025-11-01T09:00:00+09:00')
    });

    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };

    const handler = new RemindTaskUpdateOverrideModalHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any
    );

    const interaction = {
      customId: 'remind-task-update-override-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: {
        getTextInputValue: vi.fn((key: string) => {
          if (key === 'last-done-at') return '';
          if (key === 'next-due-at') return '';
          if (key === 'overdue-notify-limit') return '1';
          return '';
        })
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    const updatedTask = mockRepository.updateTask.mock.calls[0][1];
    expect(updatedTask.overdueNotifyLimit).toBe(1);
    expect(updatedTask.overdueNotifyCount).toBe(3);
    expect(updatedTask.lastOverdueNotifiedAt?.getTime()).toBe(task.lastOverdueNotifiedAt?.getTime());
  });
});
