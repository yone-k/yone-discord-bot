import { describe, it, expect, vi } from 'vitest';
import { RemindTaskDetailButtonHandler } from '../../src/buttons/RemindTaskDetailButtonHandler';
import { Logger } from '../../src/utils/logger';
import { ComponentType, MessageFlags } from 'discord.js';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskDetailButtonHandler', () => {
  it('replies with detail text', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '掃除',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      inventoryItems: [
        { name: '牛乳', stock: 3, consume: 1 },
        { name: '卵', stock: 2, consume: 1 }
      ],
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task)
    };

    const handler = new RemindTaskDetailButtonHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any
    );

    const interaction = {
      customId: 'remind-task-detail',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      replied: false,
      deferred: false,
      reply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockRepository.findTaskByMessageId).toHaveBeenCalledWith('channel-1', 'msg-1');
    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.flags).toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    expect(payload.components).toHaveLength(1);
    const container = payload.components[0];
    expect(container.type).toBe(ComponentType.Container);
    const textContents = container.components
      .filter((component: any) => component.type === ComponentType.TextDisplay)
      .map((component: any) => component.content);
    expect(textContents.some((content: string) => content.includes('掃除'))).toBe(true);
    expect(textContents.some((content: string) => content.includes('事前通知: 1日前'))).toBe(true);
    expect(textContents.some((content: string) => content.includes('在庫: 牛乳 在庫3/消費1, 卵 在庫2/消費1'))).toBe(true);
    expect(textContents.some((content: string) => content.includes('```'))).toBe(true);
  });
});
