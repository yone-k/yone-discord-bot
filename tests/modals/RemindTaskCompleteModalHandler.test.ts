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
    const mockInventoryService = {
      consumeForTask: vi.fn().mockResolvedValue({ kind: 'success' })
    };

    const handler = new RemindTaskCompleteModalHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any
    );

    const interaction = {
      customId: 'remind-task-complete-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: { getTextInputValue: vi.fn() },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith('channel-1', task);
    expect(mockRepository.updateTask).toHaveBeenCalled();
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalled();
  });

  it('refreshes linked inventory message after consuming inventory', async () => {
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
    const items = [{ id: 'item-1', name: '洗剤', stock: 2, category: '掃除' }];
    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const mockInventoryService = {
      consumeForTask: vi.fn().mockResolvedValue({ kind: 'success', linkedInventoryChannelId: 'inv-ch-1' })
    };
    const mockInventoryRepository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const mockInventoryMessageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const mockRefreshService = {
      refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
    };
    const handler = new RemindTaskCompleteModalHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any,
      mockInventoryRepository as any,
      mockInventoryMessageManager as any,
      mockRefreshService as any
    );
    const interaction = {
      customId: 'remind-task-complete-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: { getTextInputValue: vi.fn() },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryRepository.fetchAll).toHaveBeenCalledWith('inv-ch-1');
    expect(mockInventoryMessageManager.createOrUpdateMessage).toHaveBeenCalledWith(
      'inv-ch-1',
      items,
      '在庫リスト',
      interaction.client
    );
    expect(mockRefreshService.refreshTasksUsingInventory).toHaveBeenCalledWith(
      'inv-ch-1',
      interaction.client,
      { excludeMessageId: 'msg-1' }
    );
  });

  it('does not refresh inventory message when consumption succeeds without linked inventory channel', async () => {
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
    const mockInventoryService = {
      consumeForTask: vi.fn().mockResolvedValue({ kind: 'success' })
    };
    const mockInventoryRepository = {
      fetchAll: vi.fn().mockResolvedValue([])
    };
    const mockInventoryMessageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const mockRefreshService = {
      refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
    };
    const handler = new RemindTaskCompleteModalHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any,
      mockInventoryRepository as any,
      mockInventoryMessageManager as any,
      mockRefreshService as any
    );
    const interaction = {
      customId: 'remind-task-complete-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: { getTextInputValue: vi.fn() },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryRepository.fetchAll).not.toHaveBeenCalled();
    expect(mockInventoryMessageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(mockRefreshService.refreshTasksUsingInventory).not.toHaveBeenCalled();
  });

  it('blocks completion when inventory is insufficient', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      inventoryItems: [{ inventoryId: 'inventory-1', consume: 2 }],
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
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true }),
      sendReminderToThread: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { remindNoticeThreadId: 'thread-1', remindNoticeMessageId: 'notice-msg-1' }
      })
    };
    const mockInventoryService = {
      consumeForTask: vi.fn().mockResolvedValue({
        kind: 'shortage',
        items: [{ inventoryId: 'inventory-1', name: '牛乳', required: 2, available: 1 }]
      })
    };

    const handler = new RemindTaskCompleteModalHandler(
      new Logger(),
      undefined,
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any
    );

    const interaction = {
      customId: 'remind-task-complete-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: { getTextInputValue: vi.fn() },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith('channel-1', task);
    expect(mockRepository.updateTask).not.toHaveBeenCalled();
    expect(mockMessageManager.updateTaskMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('不足している在庫の詳細は以下の通りです')
    }));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('牛乳 1個')
    }));
    expect(mockMessageManager.sendReminderToThread).not.toHaveBeenCalled();
  });

  it('notifies thread when inventory becomes insufficient after completion', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      inventoryItems: [{ name: '牛乳', stock: 2, consume: 2 }],
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
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true }),
      sendReminderToThread: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { remindNoticeThreadId: 'thread-1', remindNoticeMessageId: 'notice-msg-1' }
      })
    };

    const handler = new RemindTaskCompleteModalHandler(
      new Logger(),
      undefined,
      mockMetadataManager as any,
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
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockMessageManager.sendReminderToThread).toHaveBeenCalledWith(
      'channel-1',
      'thread-1',
      'notice-msg-1',
      '@everyone 補充チェックの次回分に必要な在庫が不足しています。\n不足している在庫の詳細は以下の通りです\n牛乳 2個',
      interaction.client
    );
  });

  it('blocks completion when legacy inventory migration is required', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      inventoryItems: [{ name: '牛乳', stock: 3, consume: 1 }],
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
    const mockInventoryService = {
      consumeForTask: vi.fn().mockResolvedValue({ kind: 'migration_required' })
    };
    const handler = new RemindTaskCompleteModalHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any
    );
    const interaction = {
      customId: 'remind-task-complete-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: { getTextInputValue: vi.fn() },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith('channel-1', task);
    expect(mockRepository.updateTask).not.toHaveBeenCalled();
    expect(mockMessageManager.updateTaskMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('在庫移行')
    }));
  });

  it.each([
    {
      result: {
        kind: 'shortage',
        items: [{ inventoryId: 'inventory-1', name: '牛乳', required: 2, available: 1 }]
      }
    },
    { result: { kind: 'migration_required' } }
  ])('does not refresh inventory message when consumption is blocked by $result.kind', async ({ result }) => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      inventoryItems: [{ inventoryId: 'inventory-1', consume: 2 }],
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
    const mockInventoryService = {
      consumeForTask: vi.fn().mockResolvedValue(result)
    };
    const mockInventoryRepository = {
      fetchAll: vi.fn().mockResolvedValue([])
    };
    const mockInventoryMessageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const mockRefreshService = {
      refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
    };
    const handler = new RemindTaskCompleteModalHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any,
      mockInventoryRepository as any,
      mockInventoryMessageManager as any,
      mockRefreshService as any
    );
    const interaction = {
      customId: 'remind-task-complete-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: { getTextInputValue: vi.fn() },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryRepository.fetchAll).not.toHaveBeenCalled();
    expect(mockInventoryMessageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(mockRefreshService.refreshTasksUsingInventory).not.toHaveBeenCalled();
  });
});
