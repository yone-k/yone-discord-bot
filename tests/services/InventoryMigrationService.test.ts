import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InventoryMigrationService } from '../../src/services/InventoryMigrationService';
import type { InventoryItem } from '../../src/models/InventoryItem';
import type { RemindTask } from '../../src/models/RemindTask';

const fixedNow = new Date('2026-05-09T12:34:56.000Z');

const createTask = (
  overrides: Partial<RemindTask> = {}
): RemindTask => ({
  id: 'task-1',
  messageId: 'message-1',
  title: '掃除',
  description: '月1回',
  intervalDays: 30,
  timeOfDay: '09:00',
  remindBeforeMinutes: 1440,
  inventoryItems: [],
  startAt: new Date('2026-05-01T00:00:00.000Z'),
  nextDueAt: new Date('2026-06-01T00:00:00.000Z'),
  lastDoneAt: null,
  lastRemindDueAt: null,
  overdueNotifyCount: 0,
  overdueNotifyLimit: 3,
  lastOverdueNotifiedAt: null,
  isPaused: false,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  ...overrides
});

describe('InventoryMigrationService', () => {
  let inventoryMetadataManager: {
    getChannelMetadata: ReturnType<typeof vi.fn>;
  };
  let remindMetadataManager: {
    findChannelsLinkedToInventory: ReturnType<typeof vi.fn>;
  };
  let googleSheetsService: {
    createSheetByName: ReturnType<typeof vi.fn>;
    getSheetDataByName: ReturnType<typeof vi.fn>;
    appendSheetData: ReturnType<typeof vi.fn>;
  };
  let inventoryRepository: {
    findByName: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let remindTaskRepository: {
    fetchTasks: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
  };
  let service: InventoryMigrationService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    inventoryMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        channelId: 'inventory-channel-1',
        messageId: 'inventory-message-1',
        listTitle: '在庫リスト',
        lastSyncTime: fixedNow,
        defaultCategory: '日用品'
      })
    };
    remindMetadataManager = {
      findChannelsLinkedToInventory: vi.fn().mockResolvedValue(['task-channel-1'])
    };
    googleSheetsService = {
      createSheetByName: vi.fn().mockResolvedValue({ success: true }),
      getSheetDataByName: vi.fn().mockResolvedValue([
        ['id', 'message_id', 'title', 'inventory_items'],
        ['task-1', 'message-1', '掃除', '[{"name":"洗剤","stock":3,"consume":1}]']
      ]),
      appendSheetData: vi.fn().mockResolvedValue({ success: true })
    };
    inventoryRepository = {
      findByName: vi.fn().mockResolvedValue(null),
      append: vi.fn().mockResolvedValue({ success: true }),
      update: vi.fn().mockResolvedValue({ success: true })
    };
    remindTaskRepository = {
      fetchTasks: vi.fn().mockResolvedValue([]),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };

    service = new InventoryMigrationService(
      inventoryMetadataManager,
      remindMetadataManager,
      googleSheetsService,
      inventoryRepository,
      remindTaskRepository
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('未初期化チャンネルで実行すると success:false を返す', async () => {
    // Given
    inventoryMetadataManager.getChannelMetadata.mockResolvedValue(null);

    // When
    const report = await service.migrate('inventory-channel-1');

    // Then
    expect(report).toMatchObject({
      success: false,
      migratedTasks: 0,
      mergedItems: 0,
      backupSheets: [],
      conflictItems: [],
      skippedTasks: []
    });
    expect(report.message).toContain('/init-inventory');
    expect(remindMetadataManager.findChannelsLinkedToInventory).not.toHaveBeenCalled();
  });

  it('リンク済タスクチャンネルがない場合は成功し、移行件数とバックアップは0になる', async () => {
    // Given
    remindMetadataManager.findChannelsLinkedToInventory.mockResolvedValue([]);

    // When
    const report = await service.migrate('inventory-channel-1');

    // Then
    expect(report).toMatchObject({
      success: true,
      migratedTasks: 0,
      mergedItems: 0,
      backupSheets: [],
      conflictItems: [],
      skippedTasks: []
    });
    expect(googleSheetsService.createSheetByName).not.toHaveBeenCalled();
    expect(remindTaskRepository.fetchTasks).not.toHaveBeenCalled();
  });

  it('バックアップ作成成功時は各タスクチャンネルの remind_list シートを backup シートへコピーする', async () => {
    // Given
    remindMetadataManager.findChannelsLinkedToInventory.mockResolvedValue([
      'task-channel-1',
      'task-channel-2'
    ]);
    googleSheetsService.getSheetDataByName
      .mockResolvedValueOnce([['header-1'], ['row-1']])
      .mockResolvedValueOnce([['header-2'], ['row-2']]);

    // When
    const report = await service.migrate('inventory-channel-1');

    // Then
    expect(report.success).toBe(true);
    expect(report.backupSheets).toEqual([
      'remind_list_task-channel-1_backup_20260509123456',
      'remind_list_task-channel-2_backup_20260509123456'
    ]);
    expect(googleSheetsService.createSheetByName).toHaveBeenNthCalledWith(
      1,
      'remind_list_task-channel-1_backup_20260509123456'
    );
    expect(googleSheetsService.createSheetByName).toHaveBeenNthCalledWith(
      2,
      'remind_list_task-channel-2_backup_20260509123456'
    );
    expect(googleSheetsService.getSheetDataByName).toHaveBeenNthCalledWith(1, 'remind_list_task-channel-1');
    expect(googleSheetsService.getSheetDataByName).toHaveBeenNthCalledWith(2, 'remind_list_task-channel-2');
    expect(googleSheetsService.appendSheetData).toHaveBeenNthCalledWith(
      1,
      'remind_list_task-channel-1_backup_20260509123456',
      [['header-1'], ['row-1']]
    );
    expect(googleSheetsService.appendSheetData).toHaveBeenNthCalledWith(
      2,
      'remind_list_task-channel-2_backup_20260509123456',
      [['header-2'], ['row-2']]
    );
  });

  it('バックアップシート作成に失敗した場合は移行を中止し、ユーザー向け message を返す', async () => {
    // Given
    googleSheetsService.createSheetByName.mockResolvedValue({
      success: false,
      message: 'Google Sheets API error'
    });

    // When
    const report = await service.migrate('inventory-channel-1');

    // Then
    expect(report.success).toBe(false);
    expect(report.message).toContain('バックアップ');
    expect(report.message).toContain('Google Sheets API error');
    expect(remindTaskRepository.fetchTasks).not.toHaveBeenCalled();
    expect(inventoryRepository.append).not.toHaveBeenCalled();
    expect(remindTaskRepository.updateTask).not.toHaveBeenCalled();
  });

  it('旧形式タスクのみの場合は在庫アイテムを作成し、各タスクの inventoryItems を新形式へ書き換える', async () => {
    // Given
    const task = createTask({
      id: 'task-1',
      inventoryItems: [{ name: '洗剤', stock: 3, consume: 1 }]
    });
    remindTaskRepository.fetchTasks.mockResolvedValue([task]);
    inventoryRepository.append.mockImplementation(async (
      _channelId: string,
      item: InventoryItem
    ) => ({ success: true, item: { ...item, id: item.id } }));

    // When
    const report = await service.migrate('inventory-channel-1');

    // Then
    expect(report.success).toBe(true);
    expect(report.migratedTasks).toBe(1);
    expect(report.mergedItems).toBe(1);
    expect(inventoryRepository.findByName).toHaveBeenCalledWith('inventory-channel-1', '洗剤');
    expect(inventoryRepository.append).toHaveBeenCalledWith(
      'inventory-channel-1',
      expect.objectContaining({
        name: '洗剤',
        stock: 3,
        category: '日用品'
      })
    );
    const createdInventory = inventoryRepository.append.mock.calls[0][1] as InventoryItem;
    expect(remindTaskRepository.updateTask).toHaveBeenCalledWith(
      'task-channel-1',
      expect.objectContaining({
        id: 'task-1',
        inventoryItems: [{ inventoryId: createdInventory.id, consume: 1 }]
      })
    );
  });

  it('新形式タスクが混在する場合はそのタスクを skippedTasks に記録し、移行対象外にする', async () => {
    // Given
    const legacyTask = createTask({
      id: 'task-legacy',
      inventoryItems: [{ name: '洗剤', stock: 3, consume: 1 }]
    });
    const newTask = createTask({
      id: 'task-new',
      title: '既に移行済み',
      inventoryItems: [{ inventoryId: 'inventory-1', consume: 1 }]
    });
    remindTaskRepository.fetchTasks.mockResolvedValue([legacyTask, newTask]);

    // When
    const report = await service.migrate('inventory-channel-1');

    // Then
    expect(report.success).toBe(true);
    expect(report.migratedTasks).toBe(1);
    expect(report.skippedTasks).toEqual([
      expect.objectContaining({
        taskId: 'task-new',
        reason: expect.stringContaining('移行済み')
      })
    ]);
    expect(remindTaskRepository.updateTask).toHaveBeenCalledTimes(1);
    expect(remindTaskRepository.updateTask).toHaveBeenCalledWith(
      'task-channel-1',
      expect.objectContaining({ id: 'task-legacy' })
    );
  });

  it('同名アイテムは stock の最大値で統合し、conflictItems に記録する', async () => {
    // Given
    remindTaskRepository.fetchTasks.mockResolvedValue([
      createTask({
        id: 'task-1',
        inventoryItems: [{ name: '洗剤', stock: 3, consume: 1 }]
      }),
      createTask({
        id: 'task-2',
        inventoryItems: [{ name: '洗剤', stock: 5, consume: 2 }]
      })
    ]);

    // When
    const report = await service.migrate('inventory-channel-1');

    // Then
    expect(report.success).toBe(true);
    expect(report.migratedTasks).toBe(2);
    expect(report.mergedItems).toBe(1);
    expect(report.conflictItems).toEqual([
      expect.objectContaining({
        name: '洗剤',
        stockValues: [3, 5],
        resolvedStock: 5
      })
    ]);
    expect(inventoryRepository.append).toHaveBeenCalledTimes(1);
    expect(inventoryRepository.append).toHaveBeenCalledWith(
      'inventory-channel-1',
      expect.objectContaining({
        name: '洗剤',
        stock: 5
      })
    );
  });

  it('既存在庫に同名がある場合は既存 stock と新 stock の最大値で上書き更新する', async () => {
    // Given
    inventoryRepository.findByName.mockResolvedValue({
      id: 'inventory-existing-1',
      name: '洗剤',
      stock: 2,
      category: '日用品'
    });
    remindTaskRepository.fetchTasks.mockResolvedValue([
      createTask({
        id: 'task-1',
        inventoryItems: [{ name: '洗剤', stock: 4, consume: 1 }]
      })
    ]);

    // When
    const report = await service.migrate('inventory-channel-1');

    // Then
    expect(report.success).toBe(true);
    expect(inventoryRepository.append).not.toHaveBeenCalled();
    expect(inventoryRepository.update).toHaveBeenCalledWith(
      'inventory-channel-1',
      {
        id: 'inventory-existing-1',
        name: '洗剤',
        stock: 4,
        category: '日用品'
      }
    );
  });

  it('各タスクの inventoryItems が新形式 [{inventoryId, consume}] に書き換わって updateTask が呼ばれる', async () => {
    // Given
    inventoryRepository.findByName.mockImplementation(async (
      _channelId: string,
      name: string
    ) => name === '洗剤'
      ? { id: 'inventory-detergent', name: '洗剤', stock: 3, category: '日用品' }
      : null);
    remindTaskRepository.fetchTasks.mockResolvedValue([
      createTask({
        id: 'task-1',
        inventoryItems: [
          { name: '洗剤', stock: 3, consume: 1 },
          { name: 'スポンジ', stock: 6, consume: 2 }
        ]
      })
    ]);

    // When
    const report = await service.migrate('inventory-channel-1');

    // Then
    expect(report.success).toBe(true);
    const appendedSponge = inventoryRepository.append.mock.calls[0][1] as InventoryItem;
    expect(remindTaskRepository.updateTask).toHaveBeenCalledWith(
      'task-channel-1',
      expect.objectContaining({
        id: 'task-1',
        inventoryItems: [
          { inventoryId: 'inventory-detergent', consume: 1 },
          { inventoryId: appendedSponge.id, consume: 2 }
        ]
      })
    );
  });
});
