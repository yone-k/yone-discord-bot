import { describe, it, expect, vi } from 'vitest';
import { RemindTaskCompleteButtonHandler } from '../../src/buttons/RemindTaskCompleteButtonHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';
import type { InventoryItem } from '../../src/models/InventoryItem';

type MockFn = ReturnType<typeof vi.fn>;

type VariableInventoryMocks = {
  handler: RemindTaskCompleteButtonHandler;
  mockRepository: {
    findTaskByMessageId: MockFn;
    updateTask: MockFn;
  };
  mockInventoryService: {
    consumeForTask: MockFn;
    getById: MockFn;
  };
  mockInventoryRepository: {
    fetchAll: MockFn;
  };
  mockMetadataManager: {
    getChannelMetadata: MockFn;
  };
};

type RemindTaskCompleteInteractionMock = {
  customId: string;
  user: { id: string; bot: boolean };
  channelId: string;
  message: { id: string };
  client: any;
  deferReply: MockFn;
  deleteReply: MockFn;
  editReply: MockFn;
  reply: MockFn;
  showModal: MockFn;
};

describe('RemindTaskCompleteButtonHandler', () => {
  it('completes task and updates message', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '掃除',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
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

    const handler = new RemindTaskCompleteButtonHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any
    );
    const interaction = {
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      deferReply: vi.fn(),
      deleteReply: vi.fn(),
      editReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith('channel-1', task);
    expect(mockRepository.updateTask).toHaveBeenCalled();
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalled();
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(interaction.deleteReply).toHaveBeenCalled();
  });

  it('refreshes linked inventory message after consuming inventory', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '掃除',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
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
    const handler = new RemindTaskCompleteButtonHandler(
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
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      deferReply: vi.fn(),
      deleteReply: vi.fn(),
      editReply: vi.fn()
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
      remindBeforeMinutes: 60,
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
    const handler = new RemindTaskCompleteButtonHandler(
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
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      deferReply: vi.fn(),
      deleteReply: vi.fn(),
      editReply: vi.fn()
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
      remindBeforeMinutes: 60,
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

    const handler = new RemindTaskCompleteButtonHandler(
      new Logger(),
      undefined,
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any
    );
    const interaction = {
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      deferReply: vi.fn(),
      deleteReply: vi.fn(),
      editReply: vi.fn()
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
      remindBeforeMinutes: 60,
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
    const handler = new RemindTaskCompleteButtonHandler(
      new Logger(),
      undefined,
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any
    );
    const interaction = {
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      deferReply: vi.fn(),
      deleteReply: vi.fn(),
      editReply: vi.fn()
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
      remindBeforeMinutes: 60,
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
    const handler = new RemindTaskCompleteButtonHandler(
      new Logger(),
      undefined,
      undefined,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any
    );
    const interaction = {
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      deferReply: vi.fn(),
      deleteReply: vi.fn(),
      editReply: vi.fn()
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
      remindBeforeMinutes: 60,
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
    const handler = new RemindTaskCompleteButtonHandler(
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
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      client: {} as any,
      deferReply: vi.fn(),
      deleteReply: vi.fn(),
      editReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryRepository.fetchAll).not.toHaveBeenCalled();
    expect(mockInventoryMessageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(mockRefreshService.refreshTasksUsingInventory).not.toHaveBeenCalled();
  });

  describe('variable inventory consumption', () => {
    const baseTaskInput = {
      id: 'task-1',
      messageId: 'msg-1',
      title: '掃除',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    };

    function createMocks(task: ReturnType<typeof createRemindTask>, options?: {
      linkedInventoryChannelId?: string;
      inventoryItemsById?: Record<string, { id: string; name: string; stock: number; category: string } | null>;
    }): VariableInventoryMocks {
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
          metadata: { linkedInventoryChannelId: options?.linkedInventoryChannelId }
        })
      };
      const mockInventoryService = {
        consumeForTask: vi.fn().mockResolvedValue({
          kind: 'success',
          linkedInventoryChannelId: options?.linkedInventoryChannelId
        }),
        getById: vi.fn()
      };
      const mockInventoryRepository = {
        fetchAll: vi.fn().mockImplementation(async () => {
          return Object.values(options?.inventoryItemsById ?? {})
            .filter((item): item is InventoryItem => item !== null);
        })
      };
      const mockInventoryMessageManager = {
        createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
      };
      const mockRefreshService = {
        refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
      };
      const handler = new RemindTaskCompleteButtonHandler(
        new Logger(),
        undefined,
        mockMetadataManager as any,
        mockRepository as any,
        mockMessageManager as any,
        mockInventoryService as any,
        mockInventoryRepository as any,
        mockInventoryMessageManager as any,
        mockRefreshService as any
      );

      return {
        handler,
        mockRepository,
        mockInventoryService,
        mockInventoryRepository,
        mockMetadataManager
      };
    }

    function createInteraction(): RemindTaskCompleteInteractionMock {
      return {
        customId: 'remind-task-complete',
        user: { id: 'user-1', bot: false },
        channelId: 'channel-1',
        message: { id: 'msg-1' },
        client: {} as any,
        deferReply: vi.fn(),
        deleteReply: vi.fn(),
        editReply: vi.fn(),
        reply: vi.fn(),
        showModal: vi.fn().mockResolvedValue(undefined)
      };
    }

    it('task.inventoryItems に consume === 0 のアイテム（NewRemindInventoryItem 形式）が含まれる場合、interaction.showModal が customId=\'remind-task-complete-modal:{messageId}\' で呼ばれ、consumeForTask は呼ばれない', async () => {
      const task = createRemindTask({
        ...baseTaskInput,
        inventoryItems: [
          { inventoryId: 'inventory-1', consume: 0 },
          { inventoryId: 'inventory-2', consume: 1 }
        ]
      });
      const { handler, mockInventoryService, mockInventoryRepository } = createMocks(task, {
        linkedInventoryChannelId: 'inventory-channel-1',
        inventoryItemsById: {
          'inventory-1': { id: 'inventory-1', name: '洗剤', stock: 3, category: '' },
          'inventory-2': { id: 'inventory-2', name: 'スポンジ', stock: 5, category: '' }
        }
      });
      const interaction = createInteraction();

      await handler.handle({ interaction } as any);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
      expect(modalJson.custom_id).toMatch(/^remind-task-complete-modal:msg-1:\d+$/);
      expect(modalJson.components[0].components[0].value).toBe('洗剤,\nスポンジ,1');
      expect(mockInventoryRepository.fetchAll).toHaveBeenCalledTimes(1);
      expect(mockInventoryService.getById).not.toHaveBeenCalled();
      expect(mockInventoryService.consumeForTask).not.toHaveBeenCalled();
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('consume > 0 のアイテムだけの場合、従来通り consumeForTask が呼ばれ showModal は呼ばれない', async () => {
      const task = createRemindTask({
        ...baseTaskInput,
        inventoryItems: [{ inventoryId: 'inventory-1', consume: 1 }]
      });
      const { handler, mockInventoryService } = createMocks(task, {
        linkedInventoryChannelId: 'inventory-channel-1'
      });
      const interaction = createInteraction();

      await handler.handle({ interaction } as any);

      expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith('channel-1', task);
      expect(interaction.showModal).not.toHaveBeenCalled();
    });

    it('inventoryItems が空の場合、従来通り即時消費フローを通る（showModal が呼ばれない、consumeForTask は呼ばれる）', async () => {
      const task = createRemindTask({
        ...baseTaskInput,
        inventoryItems: []
      });
      const { handler, mockInventoryService } = createMocks(task);
      const interaction = createInteraction();

      await handler.handle({ interaction } as any);

      expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith('channel-1', task);
      expect(interaction.showModal).not.toHaveBeenCalled();
    });

    it('linkedInventoryChannelId が未設定で variable を含む場合、interaction.reply（{ content, flags: [\'Ephemeral\'] }）でエラーメッセージを返し showModal は呼ばれない', async () => {
      const task = createRemindTask({
        ...baseTaskInput,
        inventoryItems: [{ inventoryId: 'inventory-1', consume: 0 }]
      });
      const { handler, mockInventoryService, mockMetadataManager } = createMocks(task, {
        linkedInventoryChannelId: undefined
      });
      const interaction = createInteraction();

      await handler.handle({ interaction } as any);

      expect(mockMetadataManager.getChannelMetadata).toHaveBeenCalledWith('channel-1');
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '在庫チャンネルが連携されていません',
        flags: ['Ephemeral']
      });
      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(mockInventoryService.consumeForTask).not.toHaveBeenCalled();
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('完了モーダルのタイトル/ラベル/プレースホルダ/required が完了時の文言になっている', async () => {
      const task = createRemindTask({
        ...baseTaskInput,
        inventoryItems: [{ inventoryId: 'inventory-1', consume: 0 }]
      });
      const { handler, mockInventoryService, mockInventoryRepository } = createMocks(task, {
        linkedInventoryChannelId: 'inventory-channel-1',
        inventoryItemsById: {
          'inventory-1': { id: 'inventory-1', name: '洗剤', stock: 3, category: '' }
        }
      });
      const interaction = createInteraction();

      await handler.handle({ interaction } as any);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
      expect(modalJson.title).toBe('完了時の消費数入力');
      const inputComponent = modalJson.components[0].components[0];
      expect(inputComponent.label).toBe('消費数(名前,数 の形式 / 空欄でスキップor固定値)');
      expect(inputComponent.placeholder).toBe('例: 洗剤,2.5');
      expect(inputComponent.required).toBe(false);
      expect(mockInventoryRepository.fetchAll).toHaveBeenCalledTimes(1);
      expect(mockInventoryService.getById).not.toHaveBeenCalled();
    });

    it('inventoryService.getById が一部の inventoryId で null を返す場合でも、初期値は "[不明な在庫:<idの先頭8桁>]" のフォールバック表記でモーダルを表示する', async () => {
      const task = createRemindTask({
        ...baseTaskInput,
        inventoryItems: [
          { inventoryId: 'inventory-1', consume: 0 },
          { inventoryId: 'missing-inventory-2', consume: 0 }
        ]
      });
      const { handler, mockInventoryService, mockInventoryRepository } = createMocks(task, {
        linkedInventoryChannelId: 'inventory-channel-1',
        inventoryItemsById: {
          'inventory-1': { id: 'inventory-1', name: '洗剤', stock: 3, category: '' },
          'missing-inventory-2': null
        }
      });
      const interaction = createInteraction();

      await handler.handle({ interaction } as any);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
      expect(modalJson.custom_id).toMatch(/^remind-task-complete-modal:msg-1:\d+$/);
      expect(modalJson.components[0].components[0].value).toBe('洗剤,\n[不明な在庫:missing-],');
      expect(mockInventoryRepository.fetchAll).toHaveBeenCalledTimes(1);
      expect(mockInventoryService.getById).not.toHaveBeenCalled();
      expect(mockInventoryService.consumeForTask).not.toHaveBeenCalled();
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });
});
