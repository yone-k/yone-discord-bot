import { describe, it, expect, vi } from 'vitest';
import { ComponentType } from 'discord.js';
import { RemindTaskUpdateButtonHandler } from '../../src/buttons/RemindTaskUpdateButtonHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskUpdateButtonHandler', () => {
  it('updates message with selection options including message id', async () => {
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
      update: vi.fn().mockResolvedValue(undefined)
    };

    await handler.handle({ interaction } as any);

    expect(interaction.update).toHaveBeenCalled();
    const payload = interaction.update.mock.calls[0][0];
    expect(payload.components).toHaveLength(1);
    const container = payload.components[0];
    expect(container.type).toBe(ComponentType.Container);
    const actionRows = container.components.filter(
      (component: any) => component.type === ComponentType.ActionRow
    );
    expect(actionRows).toHaveLength(2);

    const selectRow = actionRows.find((row: any) =>
      row.components.some((component: any) => component.type === ComponentType.StringSelect)
    );
    const selectMenu = selectRow.components[0];
    expect(selectMenu.custom_id).toBe('remind-task-update-select:msg-1');
    const optionValues = selectMenu.options.map((option: any) => option.value);
    expect(optionValues).toContain('basic');
    expect(optionValues).toContain('override');

    const cancelRow = actionRows.find((row: any) =>
      row.components.some((component: any) => component.type === ComponentType.Button)
    );
    const cancelButton = cancelRow.components.find(
      (component: any) => component.custom_id === 'remind-task-update-cancel:msg-1'
    );
    expect(cancelButton).toBeDefined();
  });
});
