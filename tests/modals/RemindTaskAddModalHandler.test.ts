import { describe, it, expect, vi } from 'vitest';
import { RemindTaskAddModalHandler } from '../../src/modals/RemindTaskAddModalHandler';
import { Logger } from '../../src/utils/logger';

describe('RemindTaskAddModalHandler', () => {
  it('adds task from modal input', async () => {
    const mockService = {
      addTask: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' })
    };

    const handler = new RemindTaskAddModalHandler(
      new Logger(),
      undefined,
      undefined,
      mockService as any
    );

    const interaction = {
      customId: 'remind-task-add-modal',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: {
        getTextInputValue: vi.fn((key: string) => {
          if (key === 'title') return '掃除';
          if (key === 'description') return '';
          if (key === 'interval-days') return '7';
          if (key === 'time-of-day') return '';
          if (key === 'remind-before') return '1:30';
          return '';
        })
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockService.addTask).toHaveBeenCalledWith(
      'channel-1',
      {
        title: '掃除',
        description: undefined,
        intervalDays: 7,
        timeOfDay: undefined,
        remindBeforeMinutes: 90
      },
      interaction.client
    );
  });
});
