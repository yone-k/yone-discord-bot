import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryUpdateModalHandler } from '../../src/modals/InventoryUpdateModalHandler';
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
    update: ReturnType<typeof vi.fn>;
  };
  let inventoryMessageManager: {
    createOrUpdateMessage: ReturnType<typeof vi.fn>;
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
  };
  let handler: InventoryUpdateModalHandler;

  beforeEach(() => {
    logger = new MockLogger();
    inventoryService = {
      update: vi.fn()
    };
    inventoryMessageManager = {
      createOrUpdateMessage: vi.fn()
    };
    interaction = {
      customId: 'inventory_update_modal_inventory-1',
      user: { id: 'user-1' },
      channelId: 'inventory-channel-1',
      client: {},
      fields: {
        getTextInputValue: vi.fn((customId: string) => {
          if (customId === 'name') return '洗剤';
          if (customId === 'stock') return '5';
          if (customId === 'category') return '日用品';
          return '';
        })
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined)
    };
    handler = new InventoryUpdateModalHandler(
      logger as unknown as Logger,
      inventoryService as any,
      inventoryMessageManager as any
    );
  });

  it('入力値で InventoryService.update を呼び、在庫メッセージ更新後に成功応答する', async () => {
    // Given
    inventoryService.update.mockResolvedValue({ success: true });
    inventoryMessageManager.createOrUpdateMessage.mockResolvedValue({ success: true });

    // When
    await handler.handle({ interaction: interaction as any });

    // Then
    expect(inventoryService.update).toHaveBeenCalledWith('inventory-channel-1', {
      id: 'inventory-1',
      name: '洗剤',
      stock: 5,
      category: '日用品'
    });
    expect(inventoryMessageManager.createOrUpdateMessage).toHaveBeenCalled();
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('更新')
    });
  });

  it('別 id の同 name 重複エラーではエラー応答し、在庫メッセージを更新しない', async () => {
    // Given
    inventoryService.update.mockResolvedValue({
      success: false,
      message: '同名のアイテムが既に存在します'
    });

    // When
    await handler.handle({ interaction: interaction as any });

    // Then
    expect(inventoryService.update).toHaveBeenCalledWith('inventory-channel-1', {
      id: 'inventory-1',
      name: '洗剤',
      stock: 5,
      category: '日用品'
    });
    expect(inventoryMessageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('同名のアイテムが既に存在します')
    });
  });
});
