import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';
import { createRemindTask, type RemindTask } from '../../src/models/RemindTask';
import { RemindTaskRefreshService } from '../../src/services/RemindTaskRefreshService';

describe('RemindTaskRefreshService', () => {
  let metadataManager: {
    findChannelsLinkedToInventory: ReturnType<typeof vi.fn>;
  };
  let repository: {
    fetchTasks: ReturnType<typeof vi.fn>;
    referencingInventory: ReturnType<typeof vi.fn>;
  };
  let messageManager: {
    updateTaskMessage: ReturnType<typeof vi.fn>;
  };
  let logger: {
    warn: ReturnType<typeof vi.fn>;
  };
  let service: RemindTaskRefreshService;
  const client = { channels: { fetch: vi.fn() } } as unknown as Client;

  const createTask = (
    id: string,
    messageId: string,
    inventoryItems: RemindTask['inventoryItems'] = []
  ): RemindTask => createRemindTask({
    id,
    messageId,
    title: `Task ${id}`,
    intervalDays: 1,
    timeOfDay: '09:00',
    remindBeforeMinutes: 0,
    inventoryItems,
    startAt: new Date('2026-01-01T00:00:00.000Z'),
    nextDueAt: new Date('2026-01-02T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  });

  beforeEach(() => {
    metadataManager = {
      findChannelsLinkedToInventory: vi.fn()
    };
    repository = {
      fetchTasks: vi.fn(),
      referencingInventory: vi.fn()
    };
    messageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };
    logger = {
      warn: vi.fn()
    };
    service = new RemindTaskRefreshService(
      metadataManager,
      repository,
      messageManager,
      logger
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inventoryId指定時は該当inventoryIdを含むタスクのみupdateTaskMessageが呼ばれる', async () => {
    const matchingTask = { ...createTask('task-1', 'msg-1', [{ inventoryId: 'inventory-1', consume: '1' }]), channelId: 'task-channel-1' };
    repository.referencingInventory.mockResolvedValue([matchingTask]);

    await service.refreshTasksUsingInventory('inventory-channel-1', client, { inventoryId: 'inventory-1' });

    expect(repository.referencingInventory).toHaveBeenCalledWith('inventory-channel-1', 'inventory-1');
    expect(metadataManager.findChannelsLinkedToInventory).not.toHaveBeenCalled();
    expect(repository.fetchTasks).not.toHaveBeenCalled();
    expect(messageManager.updateTaskMessage).toHaveBeenCalledTimes(1);
    expect(messageManager.updateTaskMessage).toHaveBeenCalledWith(
      'task-channel-1',
      'msg-1',
      matchingTask,
      client,
      expect.any(Date)
    );
  });

  it('inventoryId未指定時はタスクチャンネルの全タスクでupdateTaskMessageが呼ばれる', async () => {
    const task1 = createTask('task-1', 'msg-1', [{ inventoryId: 'inventory-1', consume: '1' }]);
    const task2 = createTask('task-2', 'msg-2');
    metadataManager.findChannelsLinkedToInventory.mockResolvedValue(['task-channel-1', 'task-channel-2']);
    repository.fetchTasks
      .mockResolvedValueOnce([task1])
      .mockResolvedValueOnce([task2]);

    await service.refreshTasksUsingInventory('inventory-channel-1', client);

    expect(repository.fetchTasks).toHaveBeenCalledTimes(2);
    expect(repository.fetchTasks).toHaveBeenNthCalledWith(1, 'task-channel-1');
    expect(repository.fetchTasks).toHaveBeenNthCalledWith(2, 'task-channel-2');
    expect(messageManager.updateTaskMessage).toHaveBeenCalledTimes(2);
    expect(messageManager.updateTaskMessage).toHaveBeenNthCalledWith(
      1,
      'task-channel-1',
      'msg-1',
      task1,
      client,
      expect.any(Date)
    );
    expect(messageManager.updateTaskMessage).toHaveBeenNthCalledWith(
      2,
      'task-channel-2',
      'msg-2',
      task2,
      client,
      expect.any(Date)
    );
  });

  it('excludeMessageId指定時は除外タスクのupdateTaskMessageは呼ばれない', async () => {
    const excludedTask = { ...createTask('task-1', 'msg-1', [{ inventoryId: 'inventory-1', consume: '1' }]), channelId: 'task-channel-1' };
    const refreshedTask = { ...createTask('task-2', 'msg-2', [{ inventoryId: 'inventory-1', consume: '1' }]), channelId: 'task-channel-1' };
    repository.referencingInventory.mockResolvedValue([excludedTask, refreshedTask]);

    await service.refreshTasksUsingInventory('inventory-channel-1', client, {
      inventoryId: 'inventory-1',
      excludeMessageId: 'msg-1'
    });

    expect(messageManager.updateTaskMessage).toHaveBeenCalledTimes(1);
    expect(messageManager.updateTaskMessage).toHaveBeenCalledWith(
      'task-channel-1',
      'msg-2',
      refreshedTask,
      client,
      expect.any(Date)
    );
  });

  it('updateTaskMessage失敗時はwarnログを出すが他タスクは継続処理する', async () => {
    const failingTask = { ...createTask('task-1', 'msg-1', [{ inventoryId: 'inventory-1', consume: '1' }]), channelId: 'task-channel-1' };
    const succeedingTask = { ...createTask('task-2', 'msg-2', [{ inventoryId: 'inventory-1', consume: '1' }]), channelId: 'task-channel-2' };
    repository.referencingInventory.mockResolvedValue([failingTask, succeedingTask]);
    messageManager.updateTaskMessage
      .mockRejectedValueOnce(new Error('Discord edit failed'))
      .mockResolvedValueOnce({ success: true });

    await service.refreshTasksUsingInventory('inventory-channel-1', client, { inventoryId: 'inventory-1' });

    expect(messageManager.updateTaskMessage).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('Failed to refresh task message', {
      channelId: 'task-channel-1',
      messageId: 'msg-1',
      taskId: 'task-1',
      error: 'Discord edit failed'
    });
  });

  it('在庫リンク先チャンネルが0件の場合は何もしない', async () => {
    metadataManager.findChannelsLinkedToInventory.mockResolvedValue([]);

    await service.refreshTasksUsingInventory('inventory-channel-1', client);

    expect(repository.fetchTasks).not.toHaveBeenCalled();
    expect(messageManager.updateTaskMessage).not.toHaveBeenCalled();
  });
});
