import { describe, it, expect, vi } from 'vitest';
import { RemindTaskUpdateButtonHandler } from '../../src/buttons/RemindTaskUpdateButtonHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskUpdateButtonHandler', () => {
  it('shows update modal with message id', async () => {
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

    const handler = new RemindTaskUpdateButtonHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any
    );

    const interaction = {
      customId: 'remind-task-update',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      showModal: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(interaction.showModal).toHaveBeenCalled();
  });
});
