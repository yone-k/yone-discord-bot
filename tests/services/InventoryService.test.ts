import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InventoryService } from '../../src/services/InventoryService';
import type { InventoryRepository } from '../../src/services/InventoryRepository';
import type { RemindMetadataManager } from '../../src/services/RemindMetadataManager';
import type { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import type { OperationResult } from '../../src/services/GoogleSheetsService';
import type { InventoryItem } from '../../src/models/InventoryItem';
import type { RemindTask } from '../../src/models/RemindTask';

vi.mock('crypto', async importOriginal => ({
  ...(await importOriginal<typeof import('crypto')>()),
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000001')
}));

vi.mock('node:crypto', async importOriginal => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000001')
}));

type MockInventoryRepository = Pick<InventoryRepository, 'findByName' | 'findById' | 'append' | 'update' | 'delete'>;
type MockRemindMetadataManager = Pick<RemindMetadataManager, 'findChannelsLinkedToInventory' | 'getChannelMetadata'>;
type MockRemindTaskRepository = Pick<RemindTaskRepository, 'fetchTasks'>;
type MockGoogleSheetsService = {
  runWithLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T>;
};
type ConsumeForTaskResult =
  | { kind: 'success' }
  | { kind: 'shortage'; items: Array<{ inventoryId: string; name: string; required: number; available: number }> }
  | { kind: 'migration_required' };

describe('InventoryService', () => {
  let inventoryRepository: {
    findByName: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let remindMetadataManager: {
    findChannelsLinkedToInventory: ReturnType<typeof vi.fn>;
    getChannelMetadata: ReturnType<typeof vi.fn>;
  };
  let remindTaskRepository: {
    fetchTasks: ReturnType<typeof vi.fn>;
  };
  let googleSheetsService: {
    runWithLock: ReturnType<typeof vi.fn>;
  };
  let service: InventoryService;

  const channelId = 'inventory-channel-1';
  const coffeeBeans: InventoryItem = {
    id: 'item-1',
    name: 'Coffee beans',
    stock: 2,
    category: 'food'
  };
  const detergent: InventoryItem = {
    id: 'item-2',
    name: 'Detergent',
    stock: 1.5,
    category: 'daily'
  };
  const successResult: OperationResult = { success: true };

  beforeEach(() => {
    inventoryRepository = {
      findByName: vi.fn(),
      findById: vi.fn(),
      append: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    };
    remindMetadataManager = {
      findChannelsLinkedToInventory: vi.fn(),
      getChannelMetadata: vi.fn()
    };
    remindTaskRepository = {
      fetchTasks: vi.fn()
    };
    googleSheetsService = {
      runWithLock: vi.fn()
    };
    service = new (InventoryService as unknown as new (
      inventoryRepository: MockInventoryRepository,
      remindMetadataManager: MockRemindMetadataManager,
      remindTaskRepository: MockRemindTaskRepository,
      googleSheetsService: MockGoogleSheetsService
    ) => InventoryService)(
      inventoryRepository as MockInventoryRepository,
      remindMetadataManager as MockRemindMetadataManager,
      remindTaskRepository as MockRemindTaskRepository,
      googleSheetsService as MockGoogleSheetsService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveByName', () => {
    it('returns an existing InventoryItem when name exists', async () => {
      // Given
      inventoryRepository.findByName.mockResolvedValue(coffeeBeans);

      // When
      const item = await service.resolveByName(channelId, 'Coffee beans');

      // Then
      expect(item).toEqual(coffeeBeans);
      expect(inventoryRepository.findByName).toHaveBeenCalledWith(channelId, 'Coffee beans');
      expect(inventoryRepository.append).not.toHaveBeenCalled();
    });

    it('auto-creates an InventoryItem with zero stock and empty category when name does not exist', async () => {
      // Given
      inventoryRepository.findByName.mockResolvedValue(null);
      inventoryRepository.append.mockResolvedValue(successResult);

      // When
      const item = await service.resolveByName(channelId, 'Paper filter');

      // Then
      expect(item).toEqual({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Paper filter',
        stock: 0,
        category: ''
      });
      expect(inventoryRepository.findByName).toHaveBeenCalledWith(channelId, 'Paper filter');
      expect(inventoryRepository.append).toHaveBeenCalledWith(channelId, item);
    });
  });

  describe('create', () => {
    it('appends the item and returns success when name is not duplicated', async () => {
      // Given
      inventoryRepository.findByName.mockResolvedValue(null);
      inventoryRepository.append.mockResolvedValue(successResult);

      // When
      const result = await service.create(channelId, coffeeBeans);

      // Then
      expect(result).toEqual({ success: true });
      expect(inventoryRepository.findByName).toHaveBeenCalledWith(channelId, 'Coffee beans');
      expect(inventoryRepository.append).toHaveBeenCalledWith(channelId, coffeeBeans);
    });

    it('returns an error and does not append when name is duplicated', async () => {
      // Given
      inventoryRepository.findByName.mockResolvedValue(coffeeBeans);

      // When
      const result = await service.create(channelId, coffeeBeans);

      // Then
      expect(result.success).toBe(false);
      expect(result.message).toContain('既に存在');
      expect(inventoryRepository.findByName).toHaveBeenCalledWith(channelId, 'Coffee beans');
      expect(inventoryRepository.append).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates the item and returns success when target exists and name is not duplicated', async () => {
      // Given
      const updatedCoffeeBeans: InventoryItem = {
        ...coffeeBeans,
        stock: 3,
        category: 'grocery'
      };
      inventoryRepository.findById.mockResolvedValue(coffeeBeans);
      inventoryRepository.findByName.mockResolvedValue(coffeeBeans);
      inventoryRepository.update.mockResolvedValue(successResult);

      // When
      const result = await service.update(channelId, updatedCoffeeBeans);

      // Then
      expect(result).toEqual({ success: true });
      expect(inventoryRepository.findById).toHaveBeenCalledWith(channelId, 'item-1');
      expect(inventoryRepository.findByName).toHaveBeenCalledWith(channelId, 'Coffee beans');
      expect(inventoryRepository.update).toHaveBeenCalledWith(channelId, updatedCoffeeBeans);
    });

    it('returns an error and does not update when target does not exist', async () => {
      // Given
      inventoryRepository.findById.mockResolvedValue(null);

      // When
      const result = await service.update(channelId, coffeeBeans);

      // Then
      expect(result.success).toBe(false);
      expect(result.message).toContain('見つかりません');
      expect(inventoryRepository.findById).toHaveBeenCalledWith(channelId, 'item-1');
      expect(inventoryRepository.findByName).not.toHaveBeenCalled();
      expect(inventoryRepository.update).not.toHaveBeenCalled();
    });

    it('returns an error and does not update when another item has the same name', async () => {
      // Given
      const renamedCoffeeBeans: InventoryItem = {
        ...coffeeBeans,
        name: 'Detergent'
      };
      inventoryRepository.findById.mockResolvedValue(coffeeBeans);
      inventoryRepository.findByName.mockResolvedValue(detergent);

      // When
      const result = await service.update(channelId, renamedCoffeeBeans);

      // Then
      expect(result.success).toBe(false);
      expect(result.message).toContain('既に存在');
      expect(inventoryRepository.findById).toHaveBeenCalledWith(channelId, 'item-1');
      expect(inventoryRepository.findByName).toHaveBeenCalledWith(channelId, 'Detergent');
      expect(inventoryRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes the item when no remind task references it', async () => {
      // Given
      remindMetadataManager.findChannelsLinkedToInventory.mockResolvedValue(['task-channel-1', 'task-channel-2']);
      remindTaskRepository.fetchTasks
        .mockResolvedValueOnce([
          createTask({ id: 'task-1', title: 'Replace filter', inventoryItems: [{ inventoryId: 'item-2', consume: 1 }] })
        ])
        .mockResolvedValueOnce([
          createTask({ id: 'task-2', title: 'Legacy task', inventoryItems: [{ name: 'Coffee beans', stock: 2, consume: 1 }] })
        ]);
      inventoryRepository.delete.mockResolvedValue(successResult);

      // When
      await service.delete(channelId, 'item-1');

      // Then
      expect(remindMetadataManager.findChannelsLinkedToInventory).toHaveBeenCalledWith(channelId);
      expect(remindTaskRepository.fetchTasks).toHaveBeenCalledWith('task-channel-1');
      expect(remindTaskRepository.fetchTasks).toHaveBeenCalledWith('task-channel-2');
      expect(inventoryRepository.delete).toHaveBeenCalledWith(channelId, 'item-1');
    });

    it('throws an error with referenced channel ids and titles when remind tasks reference it', async () => {
      // Given
      remindMetadataManager.findChannelsLinkedToInventory.mockResolvedValue(['task-channel-1', 'task-channel-2']);
      remindTaskRepository.fetchTasks
        .mockResolvedValueOnce([
          createTask({ id: 'task-1', title: 'Brew coffee', inventoryItems: [{ inventoryId: 'item-1', consume: 1 }] }),
          createTask({ id: 'task-2', title: 'Buy filters', inventoryItems: [{ inventoryId: 'item-2', consume: 1 }] })
        ])
        .mockResolvedValueOnce([
          createTask({ id: 'task-3', title: 'Clean grinder', inventoryItems: [{ inventoryId: 'item-1', consume: 0.5 }] })
        ]);

      // When
      const promise = service.delete(channelId, 'item-1');

      // Then
      await expect(promise).rejects.toThrow();
      await promise.catch(error => {
        expect(error.message).toContain('task-channel-1');
        expect(error.message).toContain('Brew coffee');
        expect(error.message).toContain('task-channel-2');
        expect(error.message).toContain('Clean grinder');
      });
      expect(inventoryRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('consumeForTask', () => {
    const taskChannelId = 'task-channel-1';
    const linkedInventoryChannelId = 'inventory-channel-1';
    const consumeForTask = (task: RemindTask): Promise<ConsumeForTaskResult> =>
      (service as unknown as {
        consumeForTask(taskChannelId: string, task: RemindTask): Promise<ConsumeForTaskResult>;
      }).consumeForTask(taskChannelId, task);

    beforeEach(() => {
      googleSheetsService.runWithLock.mockImplementation(async (_lockKey, fn) => fn());
    });

    it('returns success without consuming inventory when task channel is not linked', async () => {
      // Given
      remindMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: { channelId: taskChannelId, linkedInventoryChannelId: undefined }
      });
      const task = createTask({
        inventoryItems: [{ inventoryId: 'item-1', consume: 1 }]
      });

      // When
      const result = await consumeForTask(task);

      // Then
      expect(result).toEqual({ kind: 'success' });
      expect(remindMetadataManager.getChannelMetadata).toHaveBeenCalledWith(taskChannelId);
      expect(googleSheetsService.runWithLock).not.toHaveBeenCalled();
      expect(inventoryRepository.findById).not.toHaveBeenCalled();
      expect(inventoryRepository.update).not.toHaveBeenCalled();
    });

    it('returns migration_required without consuming inventory when task includes a legacy inventory item', async () => {
      // Given
      remindMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: { channelId: taskChannelId, linkedInventoryChannelId }
      });
      const task = createTask({
        inventoryItems: [
          { inventoryId: 'item-1', consume: 1 },
          { name: 'Coffee beans', stock: 2, consume: 1 }
        ]
      });

      // When
      const result = await consumeForTask(task);

      // Then
      expect(result).toEqual({ kind: 'migration_required' });
      expect(googleSheetsService.runWithLock).not.toHaveBeenCalled();
      expect(inventoryRepository.findById).not.toHaveBeenCalled();
      expect(inventoryRepository.update).not.toHaveBeenCalled();
    });

    it('returns all shortages without consuming inventory when any item has insufficient stock', async () => {
      // Given
      remindMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: { channelId: taskChannelId, linkedInventoryChannelId }
      });
      inventoryRepository.findById
        .mockResolvedValueOnce({ ...coffeeBeans, stock: 0.5 })
        .mockResolvedValueOnce({ ...detergent, stock: 0 });
      const task = createTask({
        inventoryItems: [
          { inventoryId: 'item-1', consume: 1 },
          { inventoryId: 'item-2', consume: 0.5 }
        ]
      });

      // When
      const result = await consumeForTask(task);

      // Then
      expect(result).toEqual({
        kind: 'shortage',
        items: [
          { inventoryId: 'item-1', name: 'Coffee beans', required: 1, available: 0.5 },
          { inventoryId: 'item-2', name: 'Detergent', required: 0.5, available: 0 }
        ]
      });
      expect(inventoryRepository.findById).toHaveBeenCalledWith(linkedInventoryChannelId, 'item-1');
      expect(inventoryRepository.findById).toHaveBeenCalledWith(linkedInventoryChannelId, 'item-2');
      expect(inventoryRepository.update).not.toHaveBeenCalled();
    });

    it('treats a missing inventory item as shortage with zero available stock', async () => {
      // Given
      remindMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: { channelId: taskChannelId, linkedInventoryChannelId }
      });
      inventoryRepository.findById.mockResolvedValue(null);
      const task = createTask({
        inventoryItems: [{ inventoryId: 'missing-item', consume: 2 }]
      });

      // When
      const result = await consumeForTask(task);

      // Then
      expect(result).toEqual({
        kind: 'shortage',
        items: [{ inventoryId: 'missing-item', name: 'missing-item', required: 2, available: 0 }]
      });
      expect(inventoryRepository.findById).toHaveBeenCalledWith(linkedInventoryChannelId, 'missing-item');
      expect(inventoryRepository.update).not.toHaveBeenCalled();
    });

    it('updates every inventory item with consumed stock and returns success when all stocks are sufficient', async () => {
      // Given
      remindMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: { channelId: taskChannelId, linkedInventoryChannelId }
      });
      inventoryRepository.findById
        .mockResolvedValueOnce({ ...coffeeBeans, stock: 3 })
        .mockResolvedValueOnce({ ...detergent, stock: 1.5 });
      inventoryRepository.update.mockResolvedValue(successResult);
      const task = createTask({
        inventoryItems: [
          { inventoryId: 'item-1', consume: 1 },
          { inventoryId: 'item-2', consume: 0.5 }
        ]
      });

      // When
      const result = await consumeForTask(task);

      // Then
      expect(result).toEqual({ kind: 'success', linkedInventoryChannelId });
      expect(inventoryRepository.update).toHaveBeenCalledWith(linkedInventoryChannelId, {
        ...coffeeBeans,
        stock: 2
      }, { useLock: false });
      expect(inventoryRepository.update).toHaveBeenCalledWith(linkedInventoryChannelId, {
        ...detergent,
        stock: 1
      }, { useLock: false });
    });

    it('runs inventory consumption under the linked inventory channel lock', async () => {
      // Given
      remindMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: { channelId: taskChannelId, linkedInventoryChannelId }
      });
      inventoryRepository.findById.mockResolvedValue({ ...coffeeBeans, stock: 2 });
      inventoryRepository.update.mockResolvedValue(successResult);
      const task = createTask({
        inventoryItems: [{ inventoryId: 'item-1', consume: 1 }]
      });

      // When
      await consumeForTask(task);

      // Then
      expect(googleSheetsService.runWithLock).toHaveBeenCalledWith(
        `inventory_${linkedInventoryChannelId}`,
        expect.any(Function)
      );
    });
  });
});

function createTask(overrides: Partial<RemindTask>): RemindTask {
  const now = new Date('2026-05-09T00:00:00.000Z');

  return {
    id: 'task-id',
    messageId: 'message-id',
    title: 'Task title',
    description: undefined,
    intervalDays: 7,
    timeOfDay: '09:00',
    remindBeforeMinutes: 60,
    inventoryItems: [],
    startAt: now,
    nextDueAt: now,
    lastDoneAt: null,
    lastRemindDueAt: null,
    overdueNotifyCount: 0,
    overdueNotifyLimit: undefined,
    lastOverdueNotifiedAt: null,
    isPaused: false,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}
