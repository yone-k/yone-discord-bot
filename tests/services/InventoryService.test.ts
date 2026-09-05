import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InventoryService } from '../../src/services/InventoryService';
import type { InventoryRepository } from '../../src/services/InventoryRepository';
import type { RemindChannelStore } from '../../src/services/RemindChannelStore';
import type { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import type { OperationResult } from '../../src/repositories/contracts';
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

type MockInventoryRepository = Pick<InventoryRepository, 'fetchAll' | 'findByName' | 'findById' | 'append' | 'update' | 'bulkUpdate' | 'delete'>;
type MockRemindChannelStore = Pick<RemindChannelStore, 'findChannelsLinkedToInventory' | 'getChannelMetadata'>;
type MockRemindTaskRepository = Pick<RemindTaskRepository, 'referencingInventory'>;
describe('InventoryService', () => {
  let inventoryRepository: {
    fetchAll: ReturnType<typeof vi.fn>;
    findByName: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    bulkUpdate: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let remindMetadataManager: {
    findChannelsLinkedToInventory: ReturnType<typeof vi.fn>;
    getChannelMetadata: ReturnType<typeof vi.fn>;
  };
  let remindTaskRepository: {
    referencingInventory: ReturnType<typeof vi.fn>;
  };
  let service: InventoryService;

  const channelId = 'inventory-channel-1';
  const coffeeBeans: InventoryItem = {
    id: 'item-1',
    name: 'Coffee beans',
    stock: '2',
    category: 'food'
  };
  const detergent: InventoryItem = {
    id: 'item-2',
    name: 'Detergent',
    stock: '1.5',
    category: 'daily'
  };
  const successResult: OperationResult = { success: true };

  beforeEach(() => {
    inventoryRepository = {
      fetchAll: vi.fn(),
      findByName: vi.fn(),
      findById: vi.fn(),
      append: vi.fn(),
      update: vi.fn(),
      bulkUpdate: vi.fn().mockResolvedValue({ success: true }),
      delete: vi.fn()
    };
    remindMetadataManager = {
      findChannelsLinkedToInventory: vi.fn(),
      getChannelMetadata: vi.fn()
    };
    remindTaskRepository = {
      referencingInventory: vi.fn()
    };
    service = new InventoryService(
      inventoryRepository as MockInventoryRepository,
      remindMetadataManager as MockRemindChannelStore,
      remindTaskRepository as MockRemindTaskRepository
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
        stock: '0',
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
        stock: '3',
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
      remindTaskRepository.referencingInventory.mockResolvedValue([]);
      inventoryRepository.delete.mockResolvedValue(successResult);

      // When
      await service.delete(channelId, 'item-1');

      // Then
      expect(remindTaskRepository.referencingInventory).toHaveBeenCalledWith(channelId, 'item-1');
      expect(remindMetadataManager.findChannelsLinkedToInventory).not.toHaveBeenCalled();
      expect(inventoryRepository.delete).toHaveBeenCalledWith(channelId, 'item-1');
    });

    it('throws an error with referenced channel ids and titles when remind tasks reference it', async () => {
      // Given
      remindTaskRepository.referencingInventory.mockResolvedValue([
        { ...createTask({ id: 'task-1', title: 'Brew coffee' }), channelId: 'task-channel-1' },
        { ...createTask({ id: 'task-3', title: 'Clean grinder' }), channelId: 'task-channel-2' }
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

  describe('checkShortageForTask', () => {
    const taskChannelId = 'task-channel-1';
    const linkedInventoryChannelId = 'inventory-channel-1';
    const checkShortageForTask = (task: RemindTask): Promise<ConsumeForTaskResult> =>
      (service as unknown as {
        checkShortageForTask(taskChannelId: string, task: RemindTask): Promise<ConsumeForTaskResult>;
      }).checkShortageForTask(taskChannelId, task);

    it('returns success without per-item lookup when all stocks are sufficient', async () => {
      // Given
      remindMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: { channelId: taskChannelId, linkedInventoryChannelId }
      });
      inventoryRepository.fetchAll.mockResolvedValue([
        { ...coffeeBeans, stock: '3' },
        { ...detergent, stock: '1.5' }
      ]);
      inventoryRepository.findById
        .mockResolvedValueOnce({ ...coffeeBeans, stock: '3' })
        .mockResolvedValueOnce({ ...detergent, stock: '1.5' });
      const task = createTask({
        inventoryItems: [
          { inventoryId: 'item-1', consume: '1' },
          { inventoryId: 'item-2', consume: '0.5' }
        ]
      });

      // When
      const result = await checkShortageForTask(task);

      // Then
      expect(result).toEqual({ kind: 'success' });
      expect(inventoryRepository.fetchAll).toHaveBeenCalledTimes(1);
      expect(inventoryRepository.findById).not.toHaveBeenCalled();
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
