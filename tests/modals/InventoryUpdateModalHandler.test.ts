import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryUpdateModalHandler } from '../../src/modals/InventoryUpdateModalHandler';
import type { InventoryItem } from '../../src/models/InventoryItem';
import type { Logger } from '../../src/utils/logger';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('InventoryUpdateModalHandler', () => {
  let logger: MockLogger;
  let inventoryService: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let repository: {
    fetchAll: ReturnType<typeof vi.fn>;
  };
  let inventoryMessageManager: {
    createOrUpdateMessage: ReturnType<typeof vi.fn>;
  };
  let refreshService: {
    refreshTasksUsingInventory: ReturnType<typeof vi.fn>;
  };
  let interaction: {
    customId: string;
    user: { id: string };
    channelId: string;
    client: Record<string, unknown>;
    fields: {
      getTextInputValue: ReturnType<typeof vi.fn>;
    };
    deferReply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deleteReply: ReturnType<typeof vi.fn>;
  };
  let handler: InventoryUpdateModalHandler;

  const currentItems: InventoryItem[] = [
    { id: 'inventory-1', name: '洗剤', stock: 3, category: '日用品' },
    { id: 'inventory-2', name: '米', stock: 10, category: '食品' },
    { id: 'inventory-3', name: '削除対象', stock: 1, category: 'その他' }
  ];

  beforeEach(() => {
    logger = new MockLogger();
    inventoryService = {
      create: vi.fn().mockResolvedValue({ success: true }),
      update: vi.fn().mockResolvedValue({ success: true }),
      delete: vi.fn().mockResolvedValue(undefined)
    };
    repository = {
      fetchAll: vi.fn()
        .mockResolvedValueOnce(currentItems)
        .mockResolvedValueOnce([
          { id: 'inventory-1', name: '洗剤', stock: 5, category: '日用品' },
          { id: 'inventory-2', name: '米', stock: 10, category: '食品' },
          { id: 'inventory-4', name: '追加対象', stock: 2, category: '備品' }
        ])
    };
    inventoryMessageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
    };
    refreshService = {
      refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
    };
    interaction = {
      customId: 'inventory_update_modal',
      user: { id: 'user-1' },
      channelId: 'inventory-channel-1',
      client: {},
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('洗剤,5,日用品\n米,10,食品\n追加対象,2,備品')
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      deleteReply: vi.fn().mockResolvedValue(undefined)
    };
    handler = new InventoryUpdateModalHandler(
      logger as unknown as Logger,
      inventoryService as any,
      repository as any,
      inventoryMessageManager as any,
      refreshService as any
    );
  });

  it('入力CSVと既存在庫の差分からcreate/update/deleteを逐次実行し、全タスク再描画を依頼する', async () => {
    // Given
    const calls: string[] = [];
    inventoryService.create.mockImplementation(async () => {
      calls.push('create');
      return { success: true };
    });
    inventoryService.update.mockImplementation(async () => {
      calls.push('update');
      return { success: true };
    });
    inventoryService.delete.mockImplementation(async () => {
      calls.push('delete');
    });

    // When
    await handler.handle({ interaction: interaction as any });

    // Then
    expect(interaction.fields.getTextInputValue).toHaveBeenCalledWith('items');
    expect(repository.fetchAll).toHaveBeenNthCalledWith(1, 'inventory-channel-1');
    expect(inventoryService.create).toHaveBeenCalledWith('inventory-channel-1', {
      id: expect.any(String),
      name: '追加対象',
      stock: 2,
      category: '備品'
    });
    expect(inventoryService.update).toHaveBeenCalledWith('inventory-channel-1', {
      id: 'inventory-1',
      name: '洗剤',
      stock: 5,
      category: '日用品'
    });
    expect(inventoryService.delete).toHaveBeenCalledWith('inventory-channel-1', 'inventory-3');
    expect(calls).toEqual(['create', 'update', 'delete']);
    expect(inventoryMessageManager.createOrUpdateMessage).toHaveBeenCalledWith(
      'inventory-channel-1',
      [
        { id: 'inventory-1', name: '洗剤', stock: 5, category: '日用品' },
        { id: 'inventory-2', name: '米', stock: 10, category: '食品' },
        { id: 'inventory-4', name: '追加対象', stock: 2, category: '備品' }
      ],
      '在庫リスト',
      interaction.client
    );
    expect(refreshService.refreshTasksUsingInventory).toHaveBeenCalledWith(
      'inventory-channel-1',
      interaction.client
    );
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '処理が完了しました。' });
    expect(interaction.deleteReply).toHaveBeenCalled();
  });

  it('在庫数もカテゴリも変わっていない既存アイテムはupdateしない', async () => {
    // Given
    interaction.fields.getTextInputValue.mockReturnValue('洗剤,3,日用品\n米,10,食品\n削除対象,1,その他');
    repository.fetchAll
      .mockReset()
      .mockResolvedValueOnce(currentItems)
      .mockResolvedValueOnce(currentItems);

    // When
    await handler.handle({ interaction: interaction as any });

    // Then
    expect(inventoryService.create).not.toHaveBeenCalled();
    expect(inventoryService.update).not.toHaveBeenCalled();
    expect(inventoryService.delete).not.toHaveBeenCalled();
    expect(inventoryMessageManager.createOrUpdateMessage).toHaveBeenCalled();
    expect(refreshService.refreshTasksUsingInventory).toHaveBeenCalledWith(
      'inventory-channel-1',
      interaction.client
    );
  });

  it('deleteが参照タスクありでthrowした場合、途中成功後に該当アイテム名を含むエラー応答を返す', async () => {
    // Given
    inventoryService.delete.mockRejectedValue(new Error('在庫アイテムを削除できません: 参照中のタスクがあります'));

    // When
    await handler.handle({ interaction: interaction as any });

    // Then
    expect(inventoryService.create).toHaveBeenCalled();
    expect(inventoryService.update).toHaveBeenCalled();
    expect(inventoryService.delete).toHaveBeenCalledWith('inventory-channel-1', 'inventory-3');
    expect(inventoryMessageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(refreshService.refreshTasksUsingInventory).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('削除対象')
    });
    expect(interaction.deleteReply).not.toHaveBeenCalled();
  });

  it('不正なCSV入力ではパースエラーを応答し、在庫操作を実行しない', async () => {
    // Given
    interaction.fields.getTextInputValue.mockReturnValue('洗剤');

    // When
    await handler.handle({ interaction: interaction as any });

    // Then
    expect(repository.fetchAll).not.toHaveBeenCalled();
    expect(inventoryService.create).not.toHaveBeenCalled();
    expect(inventoryService.update).not.toHaveBeenCalled();
    expect(inventoryService.delete).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('1行目')
    });
  });

  it('customIdはinventory_update_modalのみ処理対象にする', () => {
    expect(handler.shouldHandle({
      interaction: { customId: 'inventory_update_modal' }
    } as any)).toBe(true);
    expect(handler.shouldHandle({
      interaction: { customId: 'inventory_update_modal_inventory-1' }
    } as any)).toBe(false);
  });
});
