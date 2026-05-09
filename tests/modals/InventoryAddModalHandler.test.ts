import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryAddModalHandler } from '../../src/modals/InventoryAddModalHandler';
import type { ModalHandlerContext } from '../../src/base/BaseModalHandler';
import type { Logger } from '../../src/utils/logger';

vi.mock('node:crypto', async importOriginal => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000029')
}));

vi.mock('crypto', async importOriginal => ({
  ...(await importOriginal<typeof import('crypto')>()),
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000029')
}));

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('InventoryAddModalHandler', () => {
  let logger: MockLogger;
  let inventoryService: {
    create: ReturnType<typeof vi.fn>;
  };
  let messageManager: {
    createOrUpdateMessage: ReturnType<typeof vi.fn>;
  };
  let repository: {
    fetchAll: ReturnType<typeof vi.fn>;
  };
  let metadataReader: {
    getChannelMetadata: ReturnType<typeof vi.fn>;
  };
  let interaction: any;
  let context: ModalHandlerContext;
  let handler: InventoryAddModalHandler;

  beforeEach(() => {
    logger = new MockLogger();
    inventoryService = {
      create: vi.fn().mockResolvedValue({ success: true })
    };
    messageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
    };
    repository = {
      fetchAll: vi.fn().mockResolvedValue([])
    };
    metadataReader = {
      getChannelMetadata: vi.fn().mockResolvedValue({ defaultCategory: '未分類' })
    };
    interaction = {
      customId: 'inventory_add_modal',
      user: { id: 'user-1' },
      guildId: 'guild-1',
      channelId: 'channel-1',
      client: { channels: { fetch: vi.fn() } },
      fields: {
        getTextInputValue: vi.fn((fieldId: string) => {
          if (fieldId === 'items') return '洗剤,5,日用品\nパン,3,食料品';
          return '';
        })
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      deleteReply: vi.fn().mockResolvedValue(undefined)
    };
    context = { interaction } as ModalHandlerContext;
    handler = new InventoryAddModalHandler(
      logger as unknown as Logger,
      inventoryService as any,
      metadataReader as any,
      repository as any,
      messageManager as any,
    );
  });

  it('Given multiple valid lines When handle is called Then it creates inventories sequentially and updates message', async () => {
    // Given
    const allItems = [
      {
        id: 'inventory-1',
        name: '洗剤',
        stock: 5,
        category: '日用品'
      },
      {
        id: 'inventory-2',
        name: 'パン',
        stock: 3,
        category: '食料品'
      }
    ];
    repository.fetchAll.mockResolvedValue(allItems);

    // When
    await handler.handle(context);

    // Then
    expect(handler.getCustomId()).toBe('inventory_add_modal');
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(interaction.fields.getTextInputValue).toHaveBeenCalledWith('items');
    expect(metadataReader.getChannelMetadata).toHaveBeenCalledWith('channel-1');
    expect(inventoryService.create).toHaveBeenNthCalledWith(1, 'channel-1', {
      id: '00000000-0000-4000-8000-000000000029',
      name: '洗剤',
      stock: 5,
      category: '日用品'
    });
    expect(inventoryService.create).toHaveBeenNthCalledWith(2, 'channel-1', {
      id: '00000000-0000-4000-8000-000000000029',
      name: 'パン',
      stock: 3,
      category: '食料品'
    });
    expect(repository.fetchAll).toHaveBeenCalledWith('channel-1');
    expect(messageManager.createOrUpdateMessage).toHaveBeenCalledWith(
      'channel-1',
      allItems,
      expect.any(String),
      interaction.client
    );
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '処理が完了しました。' });
    expect(interaction.deleteReply).toHaveBeenCalled();
  });

  it('Given item without category When handle is called Then it uses metadata default category', async () => {
    // Given
    interaction.fields.getTextInputValue = vi.fn((fieldId: string) => {
      if (fieldId === 'items') return '歯磨き粉,2';
      return '';
    });

    // When
    await handler.handle(context);

    // Then
    expect(inventoryService.create).toHaveBeenCalledWith('channel-1', {
      id: '00000000-0000-4000-8000-000000000029',
      name: '歯磨き粉',
      stock: 2,
      category: '未分類'
    });
    expect(messageManager.createOrUpdateMessage).toHaveBeenCalled();
  });

  it('Given item without category and metadata default category When handle is called Then it uses empty category', async () => {
    // Given
    metadataReader.getChannelMetadata.mockResolvedValue(null);
    interaction.fields.getTextInputValue = vi.fn((fieldId: string) => {
      if (fieldId === 'items') return '歯磨き粉,2';
      return '';
    });

    // When
    await handler.handle(context);

    // Then
    expect(inventoryService.create).toHaveBeenCalledWith('channel-1', {
      id: '00000000-0000-4000-8000-000000000029',
      name: '歯磨き粉',
      stock: 2,
      category: ''
    });
    expect(messageManager.createOrUpdateMessage).toHaveBeenCalled();
  });

  it('Given invalid items format When handle is called Then it replies parse error', async () => {
    // Given
    interaction.fields.getTextInputValue = vi.fn((fieldId: string) => {
      if (fieldId === 'items') return '洗剤,abc,日用品';
      return '';
    });

    // When
    await handler.handle(context);

    // Then
    expect(inventoryService.create).not.toHaveBeenCalled();
    expect(repository.fetchAll).not.toHaveBeenCalled();
    expect(messageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('1行目: 在庫数は数値で入力してください')
    });
  });

  it('Given empty parsed items When handle is called Then it replies validation error', async () => {
    // Given
    interaction.fields.getTextInputValue = vi.fn((fieldId: string) => {
      if (fieldId === 'items') return '   \n';
      return '';
    });

    // When
    await handler.handle(context);

    // Then
    expect(inventoryService.create).not.toHaveBeenCalled();
    expect(repository.fetchAll).not.toHaveBeenCalled();
    expect(messageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '少なくとも1件入力してください'
    });
  });

  it('Given duplicated item When handle is called Then it skips item, logs warning and updates message', async () => {
    // Given
    inventoryService.create
      .mockResolvedValueOnce({ success: false, message: '同名のアイテムが既に存在します' })
      .mockResolvedValueOnce({ success: true });

    // When
    await handler.handle(context);

    // Then
    expect(inventoryService.create).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('Skipped inventory item', {
      name: '洗剤',
      message: '同名のアイテムが既に存在します'
    });
    expect(repository.fetchAll).toHaveBeenCalledWith('channel-1');
    expect(messageManager.createOrUpdateMessage).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '処理が完了しました。' });
  });
});
