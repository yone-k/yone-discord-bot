import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComponentType, MessageFlags } from 'discord.js';
import { InventoryDeleteButtonHandler } from '../../src/buttons/InventoryDeleteButtonHandler';
import type { InventoryItem } from '../../src/models/InventoryItem';
import { InventoryFormatter } from '../../src/ui/InventoryFormatter';
import { Logger } from '../../src/utils/logger';

const createInventoryItems = (count: number): InventoryItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `inventory-${index + 1}`,
    name: `在庫${index + 1}`,
    stock: index + 1,
    category: index % 2 === 0 ? '日用品' : '食品'
  }));

const selectionComponents = [
  {
    type: ComponentType.Container,
    components: []
  }
];

describe('InventoryDeleteButtonHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Given inventory items When handle is called Then it updates inventory message with delete selection components', async () => {
    // Given
    const items = createInventoryItems(2);
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const metadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        listTitle: '備品リスト',
        defaultCategory: '日用品'
      })
    };
    const formatDataContent = vi
      .spyOn(InventoryFormatter, 'formatDataContent')
      .mockResolvedValue('formatted inventory content');
    const buildInventorySelectionComponents = vi
      .spyOn(InventoryFormatter, 'buildInventorySelectionComponents')
      .mockReturnValue(selectionComponents as any);
    const handler = new InventoryDeleteButtonHandler(new Logger(), repository as any, metadataManager as any);
    const interaction = {
      customId: 'inventory_delete',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      reply: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined)
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(handler.getCustomId()).toBe('inventory_delete');
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(metadataManager.getChannelMetadata).toHaveBeenCalledWith('inventory-channel-1');
    expect(formatDataContent).toHaveBeenCalledWith(items, '備品リスト', 'inventory-channel-1', '日用品');
    expect(buildInventorySelectionComponents).toHaveBeenCalledWith(
      'formatted inventory content',
      items,
      'delete',
      0
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith({
      flags: MessageFlags.IsComponentsV2,
      components: selectionComponents
    });
  });

  it('Given no inventory items When handle is called Then it replies item empty error', async () => {
    // Given
    const repository = {
      fetchAll: vi.fn().mockResolvedValue([])
    };
    const formatDataContent = vi.spyOn(InventoryFormatter, 'formatDataContent');
    const buildInventorySelectionComponents = vi.spyOn(InventoryFormatter, 'buildInventorySelectionComponents');
    const handler = new InventoryDeleteButtonHandler(new Logger(), repository as any);
    const interaction = {
      customId: 'inventory_delete',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      reply: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined)
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('アイテムがありません'),
      flags: ['Ephemeral']
    });
    expect(interaction.update).not.toHaveBeenCalled();
    expect(formatDataContent).not.toHaveBeenCalled();
    expect(buildInventorySelectionComponents).not.toHaveBeenCalled();
  });

  it('Given page customId When handle is called Then it updates inventory message with requested page', async () => {
    // Given
    const items = createInventoryItems(30);
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const metadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue(null)
    };
    vi.spyOn(InventoryFormatter, 'formatDataContent').mockResolvedValue('formatted inventory content');
    const buildInventorySelectionComponents = vi
      .spyOn(InventoryFormatter, 'buildInventorySelectionComponents')
      .mockReturnValue(selectionComponents as any);
    const handler = new InventoryDeleteButtonHandler(new Logger(), repository as any, metadataManager as any);
    const interaction = {
      customId: 'inventory_delete?page=1',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      reply: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined)
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(buildInventorySelectionComponents).toHaveBeenCalledWith(
      'formatted inventory content',
      items,
      'delete',
      1
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith({
      flags: MessageFlags.IsComponentsV2,
      components: selectionComponents
    });
  });
});
