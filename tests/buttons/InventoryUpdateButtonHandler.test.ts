import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextInputStyle } from 'discord.js';
import { InventoryUpdateButtonHandler } from '../../src/buttons/InventoryUpdateButtonHandler';
import type { InventoryItem } from '../../src/models/InventoryItem';
import * as InventoryParser from '../../src/utils/InventoryParser';
import { Logger } from '../../src/utils/logger';

const findTextInput = (modalJson: any, customId: string): any | undefined => {
  return modalJson.components
    .flatMap((row: any) => row.components)
    .find((component: any) => component.custom_id === customId);
};

describe('InventoryUpdateButtonHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ボタン押下時、全在庫をCSV化して一括編集モーダルを表示する', async () => {
    // Given
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const items: InventoryItem[] = [
      { id: 'inventory-1', name: '洗剤', stock: 3, category: '日用品' },
      { id: 'inventory-2', name: '米', stock: 10.5, category: '食品' }
    ];
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const handler = new InventoryUpdateButtonHandler(new Logger(), repository as any);
    const interaction = {
      customId: 'inventory_update',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      showModal: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      update: vi.fn()
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();

    const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
    expect(modalJson.custom_id).toBe('inventory_update_modal:1700000000000');
    expect(modalJson.title).toContain('在庫');

    const input = findTextInput(modalJson, 'items');
    expect(input).toEqual(expect.objectContaining({
      custom_id: 'items',
      label: '在庫一覧（名前,在庫数,カテゴリ）を編集',
      style: TextInputStyle.Paragraph,
      required: false,
      value: '米,10.5,食品\n洗剤,3,日用品'
    }));
  });

  it('メタデータのdefaultCategoryをCSV整形関数の第2引数に渡す', async () => {
    // Given
    const items: InventoryItem[] = [
      { id: 'inventory-1', name: 'パン', stock: 3, category: '' }
    ];
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const metadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { defaultCategory: '食料品' }
      })
    };
    const formatSpy = vi.spyOn(InventoryParser, 'formatInventoryCsvText');
    const handler = new InventoryUpdateButtonHandler(
      new Logger(),
      repository as any,
      undefined,
      metadataManager as any
    );
    const interaction = {
      customId: 'inventory_update',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      showModal: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      update: vi.fn()
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(metadataManager.getChannelMetadata).toHaveBeenCalledWith('inventory-channel-1');
    expect(formatSpy).toHaveBeenCalledWith(items, '食料品');
  });

  it('metadata.defaultCategory が未設定時、その他がformatInventoryCsvTextに渡される', async () => {
    // Given
    const items: InventoryItem[] = [
      { id: 'inventory-1', name: 'パン', stock: 3, category: '' }
    ];
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const metadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { channelId: 'channel-1' }
      })
    };
    const formatSpy = vi.spyOn(InventoryParser, 'formatInventoryCsvText');
    const handler = new InventoryUpdateButtonHandler(
      new Logger(),
      repository as any,
      undefined,
      metadataManager as any
    );
    const interaction = {
      customId: 'inventory_update',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      showModal: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      update: vi.fn()
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(metadataManager.getChannelMetadata).toHaveBeenCalledWith('inventory-channel-1');
    expect(formatSpy).toHaveBeenCalledWith(items, 'その他');
  });

  it('metadata.defaultCategory が空文字時、その他がformatInventoryCsvTextに渡される', async () => {
    // Given
    const items: InventoryItem[] = [
      { id: 'inventory-1', name: 'パン', stock: 3, category: '' }
    ];
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const metadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { channelId: 'channel-1', defaultCategory: '' }
      })
    };
    const formatSpy = vi.spyOn(InventoryParser, 'formatInventoryCsvText');
    const handler = new InventoryUpdateButtonHandler(
      new Logger(),
      repository as any,
      undefined,
      metadataManager as any
    );
    const interaction = {
      customId: 'inventory_update',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      showModal: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      update: vi.fn()
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(metadataManager.getChannelMetadata).toHaveBeenCalledWith('inventory-channel-1');
    expect(formatSpy).toHaveBeenCalledWith(items, 'その他');
  });

  it('inventoryMetadataReader経由でdefaultCategoryを取得しformatInventoryCsvTextに渡す', async () => {
    // Given
    const items: InventoryItem[] = [
      { id: 'inventory-1', name: '洗剤', stock: 3, category: '' }
    ];
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const inventoryMetadataReader = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        channelId: 'inventory-channel-1',
        messageId: 'message-1',
        listTitle: '在庫',
        lastSyncTime: new Date('2026-05-09T00:00:00.000Z'),
        defaultCategory: '日用品'
      })
    };
    const formatSpy = vi.spyOn(InventoryParser, 'formatInventoryCsvText');
    const handler = new InventoryUpdateButtonHandler(
      new Logger(),
      repository as any,
      undefined,
      undefined,
      inventoryMetadataReader as any
    );
    const interaction = {
      customId: 'inventory_update',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      showModal: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      update: vi.fn()
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(inventoryMetadataReader.getChannelMetadata).toHaveBeenCalledWith('inventory-channel-1');
    expect(formatSpy).toHaveBeenCalledWith(items, '日用品');
  });

  it('inventoryMetadataReaderがnullを返した場合はその他を使う', async () => {
    // Given
    const items: InventoryItem[] = [
      { id: 'inventory-1', name: '洗剤', stock: 3, category: '' }
    ];
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const inventoryMetadataReader = {
      getChannelMetadata: vi.fn().mockResolvedValue(null)
    };
    const formatSpy = vi.spyOn(InventoryParser, 'formatInventoryCsvText');
    const handler = new InventoryUpdateButtonHandler(
      new Logger(),
      repository as any,
      undefined,
      undefined,
      inventoryMetadataReader as any
    );
    const interaction = {
      customId: 'inventory_update',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      showModal: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      update: vi.fn()
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(inventoryMetadataReader.getChannelMetadata).toHaveBeenCalledWith('inventory-channel-1');
    expect(formatSpy).toHaveBeenCalledWith(items, 'その他');
  });

  it('メタデータが取得できない場合はCSV整形関数の第2引数にその他を渡す', async () => {
    // Given
    const items: InventoryItem[] = [
      { id: 'inventory-1', name: 'パン', stock: 3, category: '' }
    ];
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const metadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: false
      })
    };
    const formatSpy = vi.spyOn(InventoryParser, 'formatInventoryCsvText');
    const handler = new InventoryUpdateButtonHandler(
      new Logger(),
      repository as any,
      undefined,
      metadataManager as any
    );
    const interaction = {
      customId: 'inventory_update',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      showModal: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      update: vi.fn()
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(metadataManager.getChannelMetadata).toHaveBeenCalledWith('inventory-channel-1');
    expect(formatSpy).toHaveBeenCalledWith(items, 'その他');
  });

  it('TextInputのsetValueにdefaultCategory反映後のソート済みCSVを設定する', async () => {
    // Given
    const items: InventoryItem[] = [
      { id: 'inventory-1', name: '米', stock: 5, category: '食料品' },
      { id: 'inventory-2', name: 'パン', stock: 3, category: '' },
    ];
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const metadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { defaultCategory: '食料品' },
      })
    };
    const handler = new InventoryUpdateButtonHandler(
      new Logger(),
      repository as any,
      undefined,
      metadataManager as any
    );
    const interaction = {
      customId: 'inventory_update',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      showModal: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      update: vi.fn(),
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
    const input = findTextInput(modalJson, 'items');
    expect(input?.value).toBe('米,5,食料品\nパン,3,食料品');
  });

  it('在庫0件でも空値とplaceholder付きの一括編集モーダルを表示する', async () => {
    // Given
    const repository = {
      fetchAll: vi.fn().mockResolvedValue([])
    };
    const handler = new InventoryUpdateButtonHandler(new Logger(), repository as any);
    const interaction = {
      customId: 'inventory_update',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      showModal: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      update: vi.fn()
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();

    const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
    const input = findTextInput(modalJson, 'items');
    expect(input?.value).toBe('');
    expect(input?.placeholder).toContain('例: 洗剤,3,日用品');
  });

  it('ページング用customIdは処理対象外にする', () => {
    // Given
    const handler = new InventoryUpdateButtonHandler(new Logger(), {
      fetchAll: vi.fn()
    } as any);

    // When / Then
    expect(handler.shouldHandle({
      interaction: {
        customId: 'inventory_update?page=1',
        user: { bot: false }
      }
    } as any)).toBe(false);
  });
});
