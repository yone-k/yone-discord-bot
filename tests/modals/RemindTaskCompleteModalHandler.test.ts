import { describe, it, expect, vi } from 'vitest';
import { RemindTaskCompleteModalHandler } from '../../src/modals/RemindTaskCompleteModalHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskCompleteModalHandler', () => {
  it('completes task and updates message', async () => {
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

    const handler = new RemindTaskCompleteModalHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any
    );

    const interaction = {
      customId: 'remind-task-complete-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: { getTextInputValue: vi.fn() },
      deferReply: vi.fn(),
      editReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockRepository.updateTask).toHaveBeenCalled();
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalled();
  });
});
