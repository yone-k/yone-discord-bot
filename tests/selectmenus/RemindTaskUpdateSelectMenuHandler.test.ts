import { describe, it, expect, vi } from 'vitest';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';
import { RemindTaskUpdateSelectMenuHandler } from '../../src/selectmenus/RemindTaskUpdateSelectMenuHandler';

describe('RemindTaskUpdateSelectMenuHandler', () => {
  it.each([
    { value: 'basic', expectedCustomId: 'remind-task-update-modal:msg-1' },
    { value: 'advanced', expectedCustomId: 'remind-task-update-override-modal:msg-1' },
    { value: 'inventory', expectedCustomId: 'remind-task-inventory-modal:msg-1' }
  ])('restores task message before showing modal for %s selection', async ({ value, expectedCustomId }) => {
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
      updateTaskMessage: vi.fn().mockResolvedValue(undefined)
    };

    const handler = new RemindTaskUpdateSelectMenuHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any
    );

    const interaction = {
      customId: 'remind-task-update-select:msg-1',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      values: [value],
      client: {} as any,
      showModal: vi.fn().mockResolvedValue(undefined)
    };

    await handler.handle({ interaction } as any);

    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalledWith(
      'channel-1',
      'msg-1',
      task,
      interaction.client,
      expect.any(Date)
    );
    expect(interaction.showModal).toHaveBeenCalled();
    const modal = interaction.showModal.mock.calls[0][0];
    expect(modal.toJSON().custom_id).toBe(expectedCustomId);
    const updateOrder = mockMessageManager.updateTaskMessage.mock.invocationCallOrder[0];
    const modalOrder = interaction.showModal.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(modalOrder);
  });
});
