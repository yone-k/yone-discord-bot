import { describe, it, expect, vi } from 'vitest';
import { RemindTaskUpdateBasicButtonHandler } from '../../src/buttons/RemindTaskUpdateBasicButtonHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskUpdateBasicButtonHandler', () => {
  it('shows update modal using message id from customId', async () => {
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
      findTaskByMessageId: vi.fn().mockResolvedValue(task)
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };

    const handler = new RemindTaskUpdateBasicButtonHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any
    );

    const interaction = {
      customId: 'remind-task-update-basic:msg-1',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      showModal: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(interaction.showModal).toHaveBeenCalled();
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalledWith(
      'channel-1',
      'msg-1',
      task,
      interaction.client,
      expect.any(Date)
    );
    const modalCall = interaction.showModal.mock.calls[0][0];
    expect(modalCall.data.custom_id).toBe('remind-task-update-modal:msg-1');
  });
});
