import { describe, it, expect, vi } from 'vitest';
import { RemindTaskInventoryModalHandler } from '../../src/modals/RemindTaskInventoryModalHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskInventoryModalHandler', () => {
  it('updates inventory items and task message', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
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
    const mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { linkedInventoryChannelId: 'inventory-channel-1' }
      })
    };
    const mockInventoryService = {
      resolveByName: vi.fn().mockResolvedValue({
        id: 'inventory-1',
        name: 'フィルター',
        stock: 0,
        category: ''
      }),
      update: vi.fn(),
      getById: vi.fn()
    };
    const mockInventoryRepository = {
      fetchAll: vi.fn()
    };
    const mockInventoryMessageManager = {
      createOrUpdateMessage: vi.fn()
    };
    const refreshService = {
      refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
    };

    const handler = new RemindTaskInventoryModalHandler(
      new Logger(),
      undefined,
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any,
      mockInventoryRepository as any,
      mockInventoryMessageManager as any,
      refreshService
    );

    const interaction = {
      customId: 'remind-task-inventory-modal:msg-1:1700000000000',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('フィルター,1')
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockRepository.findTaskByMessageId).toHaveBeenCalledWith('channel-1', 'msg-1');
    expect(mockMetadataManager.getChannelMetadata).toHaveBeenCalledWith('channel-1');
    expect(mockInventoryService.resolveByName).toHaveBeenCalledWith('inventory-channel-1', 'フィルター');
    expect(mockRepository.updateTask).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'inventory-1', consume: 1 }]
      })
    );
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalled();
  });

  it('updates inventory sheet and refreshes inventory message when stock is provided', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });
    const inventoryItem = {
      id: 'inventory-1',
      name: '米',
      stock: 0,
      category: ''
    };
    const allItems = [
      {
        ...inventoryItem,
        stock: 5
      }
    ];
    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { linkedInventoryChannelId: 'inventory-channel-1' }
      })
    };
    const mockInventoryService = {
      resolveByName: vi.fn().mockResolvedValue(inventoryItem),
      update: vi.fn().mockResolvedValue({ success: true }),
      getById: vi.fn()
    };
    const mockInventoryRepository = {
      fetchAll: vi.fn().mockResolvedValue(allItems)
    };
    const mockInventoryMessageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const refreshService = {
      refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
    };

    const handler = new (RemindTaskInventoryModalHandler as any)(
      new Logger(),
      undefined,
      mockMetadataManager,
      mockRepository,
      mockMessageManager,
      mockInventoryService,
      mockInventoryRepository,
      mockInventoryMessageManager,
      refreshService
    );

    const interaction = {
      customId: 'remind-task-inventory-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('米,5,1')
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryService.resolveByName).toHaveBeenCalledWith('inventory-channel-1', '米');
    expect(mockInventoryService.update).toHaveBeenCalledWith('inventory-channel-1', {
      ...inventoryItem,
      stock: 5
    });
    expect(mockInventoryRepository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(mockInventoryMessageManager.createOrUpdateMessage).toHaveBeenCalledWith(
      'inventory-channel-1',
      allItems,
      expect.any(String),
      interaction.client
    );
    expect(refreshService.refreshTasksUsingInventory).toHaveBeenCalledWith('inventory-channel-1', interaction.client, {
      excludeMessageId: 'msg-1'
    });
    expect(mockRepository.updateTask).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'inventory-1', consume: 1 }]
      })
    );
  });

  it('アイテム名,5,0 のように消費=0 を入力すると variable モードのアイテムとしてタスクに設定できる', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });
    const inventoryItem = {
      id: 'inventory-1',
      name: 'アイテム名',
      stock: 0,
      category: ''
    };
    const allItems = [
      {
        ...inventoryItem,
        stock: 5
      }
    ];
    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { linkedInventoryChannelId: 'inventory-channel-1' }
      })
    };
    const mockInventoryService = {
      resolveByName: vi.fn().mockResolvedValue(inventoryItem),
      update: vi.fn().mockResolvedValue({ success: true }),
      getById: vi.fn()
    };
    const mockInventoryRepository = {
      fetchAll: vi.fn().mockResolvedValue(allItems)
    };
    const mockInventoryMessageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const refreshService = {
      refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
    };
    const handler = new (RemindTaskInventoryModalHandler as any)(
      new Logger(),
      undefined,
      mockMetadataManager,
      mockRepository,
      mockMessageManager,
      mockInventoryService,
      mockInventoryRepository,
      mockInventoryMessageManager,
      refreshService
    );
    const interaction = {
      customId: 'remind-task-inventory-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('アイテム名,5,0')
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryService.resolveByName).toHaveBeenCalledWith('inventory-channel-1', 'アイテム名');
    expect(mockInventoryService.update).toHaveBeenCalledWith('inventory-channel-1', {
      ...inventoryItem,
      stock: 5
    });
    expect(mockRepository.updateTask).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'inventory-1', consume: 0 }]
      })
    );
  });

  it('does not update inventory sheet or refresh inventory message when stock is omitted', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
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
    const mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { linkedInventoryChannelId: 'inventory-channel-1' }
      })
    };
    const mockInventoryService = {
      resolveByName: vi.fn().mockResolvedValue({
        id: 'inventory-1',
        name: '米',
        stock: 9,
        category: ''
      }),
      update: vi.fn(),
      getById: vi.fn()
    };
    const mockInventoryRepository = {
      fetchAll: vi.fn()
    };
    const mockInventoryMessageManager = {
      createOrUpdateMessage: vi.fn()
    };
    const refreshService = {
      refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
    };
    const handler = new (RemindTaskInventoryModalHandler as any)(
      new Logger(),
      undefined,
      mockMetadataManager,
      mockRepository,
      mockMessageManager,
      mockInventoryService,
      mockInventoryRepository,
      mockInventoryMessageManager,
      refreshService
    );
    const interaction = {
      customId: 'remind-task-inventory-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('米,1')
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockInventoryService.resolveByName).toHaveBeenCalledWith('inventory-channel-1', '米');
    expect(mockInventoryService.update).not.toHaveBeenCalled();
    expect(mockInventoryRepository.fetchAll).not.toHaveBeenCalled();
    expect(mockInventoryMessageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(refreshService.refreshTasksUsingInventory).not.toHaveBeenCalled();
    expect(mockRepository.updateTask).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'inventory-1', consume: 1 }]
      })
    );
  });

  it('複数アイテムを逐次処理する（race condition回避）', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });
    const callOrder: string[] = [];
    let resolveFirstUpdate: (() => void) | undefined;
    const firstUpdatePending = new Promise<void>((resolve) => {
      resolveFirstUpdate = resolve;
    });
    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { linkedInventoryChannelId: 'inventory-channel-1' }
      })
    };
    const mockInventoryService = {
      resolveByName: vi.fn().mockImplementation(async (_channelId: string, name: string) => {
        callOrder.push(`resolveByName:${name}`);
        return { id: `id-${name}`, name, stock: 0, category: '' };
      }),
      update: vi.fn().mockImplementation(async (_channelId: string, item: { name: string }) => {
        callOrder.push(`update:${item.name}`);
        if (item.name === '米') {
          await firstUpdatePending;
        }
        return { success: true };
      }),
      getById: vi.fn()
    };
    const mockInventoryRepository = {
      fetchAll: vi.fn().mockResolvedValue([])
    };
    const mockInventoryMessageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const refreshService = {
      refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
    };
    const handler = new (RemindTaskInventoryModalHandler as any)(
      new Logger(),
      undefined,
      mockMetadataManager,
      mockRepository,
      mockMessageManager,
      mockInventoryService,
      mockInventoryRepository,
      mockInventoryMessageManager,
      refreshService
    );
    const interaction = {
      customId: 'remind-task-inventory-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('米,5,1\nパン,10,2')
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    const handlePromise = handler.handle({ interaction } as any);
    await vi.waitFor(() => {
      expect(mockInventoryService.update).toHaveBeenCalledWith(
        'inventory-channel-1',
        expect.objectContaining({ name: '米', stock: 5 })
      );
    });

    expect(mockInventoryService.resolveByName).not.toHaveBeenCalledWith('inventory-channel-1', 'パン');

    resolveFirstUpdate?.();
    await handlePromise;

    expect(callOrder).toEqual(['resolveByName:米', 'update:米', 'resolveByName:パン', 'update:パン']);
  });
});
