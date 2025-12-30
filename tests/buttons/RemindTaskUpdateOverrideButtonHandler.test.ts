import { describe, it, expect, vi } from 'vitest';
import { RemindTaskUpdateOverrideButtonHandler } from '../../src/buttons/RemindTaskUpdateOverrideButtonHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskUpdateOverrideButtonHandler', () => {
  it('shows override modal using message id from customId', async () => {
    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(createRemindTask({
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
      }))
    };

    const handler = new RemindTaskUpdateOverrideButtonHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any
    );

    const interaction = {
      customId: 'remind-task-update-override:msg-1',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { delete: vi.fn() },
      showModal: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(interaction.showModal).toHaveBeenCalled();
    expect(interaction.message.delete).toHaveBeenCalled();
    const modalCall = interaction.showModal.mock.calls[0][0];
    expect(modalCall.data.custom_id).toBe('remind-task-update-override-modal:msg-1');
  });
});
