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
    interaction = {
      customId: 'inventory_add_modal',
      user: { id: 'user-1' },
      guildId: 'guild-1',
      channelId: 'channel-1',
      client: { channels: { fetch: vi.fn() } },
      fields: {
        getTextInputValue: vi.fn((fieldId: string) => {
          if (fieldId === 'name') return '洗剤';
          if (fieldId === 'stock') return '3';
          if (fieldId === 'category') return '日用品';
          return '';
        })
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined)
    };
    context = { interaction } as ModalHandlerContext;
    handler = new InventoryAddModalHandler(
      logger as unknown as Logger,
      inventoryService as any,
      messageManager as any
    );
  });

  it('Given valid input When handle is called Then it creates inventory and updates message with ephemeral success', async () => {
    // Given
    const expectedItem = {
      id: '00000000-0000-4000-8000-000000000029',
      name: '洗剤',
      stock: 3,
      category: '日用品'
    };

    // When
    await handler.handle(context);

    // Then
    expect(handler.getCustomId()).toBe('inventory_add_modal');
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(inventoryService.create).toHaveBeenCalledWith('channel-1', expectedItem);
    expect(messageManager.createOrUpdateMessage).toHaveBeenCalledWith(
      'channel-1',
      expect.arrayContaining([expectedItem]),
      expect.any(String),
      interaction.client
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('追加')
    });
  });

  it('Given non numeric stock When handle is called Then it replies validation error', async () => {
    // Given
    interaction.fields.getTextInputValue = vi.fn((fieldId: string) => {
      if (fieldId === 'name') return '洗剤';
      if (fieldId === 'stock') return 'abc';
      if (fieldId === 'category') return '日用品';
      return '';
    });

    // When
    await handler.handle(context);

    // Then
    expect(inventoryService.create).not.toHaveBeenCalled();
    expect(messageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('数値')
    });
  });

  it('Given empty name When handle is called Then it replies validation error', async () => {
    // Given
    interaction.fields.getTextInputValue = vi.fn((fieldId: string) => {
      if (fieldId === 'name') return '   ';
      if (fieldId === 'stock') return '3';
      if (fieldId === 'category') return '日用品';
      return '';
    });

    // When
    await handler.handle(context);

    // Then
    expect(inventoryService.create).not.toHaveBeenCalled();
    expect(messageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('名前')
    });
  });

  it('Given duplicated item When handle is called Then it replies ephemeral error without showing modal again', async () => {
    // Given
    inventoryService.create.mockResolvedValue({
      success: false,
      message: '同名のアイテムが既に存在します'
    });
    interaction.showModal = vi.fn();

    // When
    await handler.handle(context);

    // Then
    expect(inventoryService.create).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        name: '洗剤',
        stock: 3,
        category: '日用品'
      })
    );
    expect(messageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('同名のアイテムが既に存在します')
    });
  });

  it('Given empty category When handle is called Then it creates inventory with empty category', async () => {
    // Given
    interaction.fields.getTextInputValue = vi.fn((fieldId: string) => {
      if (fieldId === 'name') return '洗剤';
      if (fieldId === 'stock') return '3';
      if (fieldId === 'category') return '';
      return '';
    });

    // When
    await handler.handle(context);

    // Then
    expect(inventoryService.create).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        name: '洗剤',
        stock: 3,
        category: ''
      })
    );
    expect(messageManager.createOrUpdateMessage).toHaveBeenCalled();
  });
});
