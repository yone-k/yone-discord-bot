import { describe, it, expect, vi } from 'vitest';
import { RemindTaskUpdateCancelButtonHandler } from '../../src/buttons/RemindTaskUpdateCancelButtonHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskUpdateCancelButtonHandler', () => {
  it('restores task message when cancel is selected', async () => {
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
      buildTaskMessageComponents: vi.fn().mockReturnValue([{ type: 0 }])
    };

    const handler = new RemindTaskUpdateCancelButtonHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any
    );

    const interaction = {
      customId: 'remind-task-update-cancel:msg-1',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      update: vi.fn().mockResolvedValue(undefined)
    };

    await handler.handle({ interaction } as any);

    expect(mockMessageManager.buildTaskMessageComponents).toHaveBeenCalledWith(task, expect.any(Date));
    expect(interaction.update).toHaveBeenCalledWith({ components: [{ type: 0 }] });
  });
});
