import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComponentType, MessageFlags } from 'discord.js';
import { InventorySelectionCancelButtonHandler } from '../../src/buttons/InventorySelectionCancelButtonHandler';
import type { InventoryItem } from '../../src/models/InventoryItem';
import { InventoryFormatter } from '../../src/ui/InventoryFormatter';
import { Logger } from '../../src/utils/logger';

const createInventoryItems = (): InventoryItem[] => [
  {
    id: 'inventory-1',
    name: '洗剤',
    stock: '5',
    category: '日用品'
  }
];

const inventoryComponents = [
  {
    type: ComponentType.Container,
    components: []
  }
];

describe('InventorySelectionCancelButtonHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Given inventory selection cancel customId When shouldHandle is called Then returns true', () => {
    // Given
    const handler = new InventorySelectionCancelButtonHandler(new Logger(), { fetchAll: vi.fn() } as any);

    // When
    const shouldHandle = handler.shouldHandle({
      interaction: {
        customId: 'inventory_selection_cancel',
        user: { bot: false }
      }
    } as any);

    // Then
    expect(shouldHandle).toBe(true);
    expect(handler.getCustomId()).toBe('inventory_selection_cancel');
  });

  it('Given bot user When shouldHandle is called Then returns false', () => {
    // Given
    const handler = new InventorySelectionCancelButtonHandler(new Logger(), { fetchAll: vi.fn() } as any);

    // When
    const shouldHandle = handler.shouldHandle({
      interaction: {
        customId: 'inventory_selection_cancel',
        user: { bot: true }
      }
    } as any);

    // Then
    expect(shouldHandle).toBe(false);
  });

  it('Given inventory items When handle is called Then it restores normal inventory components', async () => {
    // Given
    const items = createInventoryItems();
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
    const formatEmptyContent = vi.spyOn(InventoryFormatter, 'formatEmptyContent');
    const buildInventoryComponents = vi
      .spyOn(InventoryFormatter, 'buildInventoryComponents')
      .mockReturnValue(inventoryComponents as any);
    const handler = new InventorySelectionCancelButtonHandler(
      new Logger(),
      repository as any,
      metadataManager as any
    );
    const interaction = {
      customId: 'inventory_selection_cancel',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      update: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined)
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(metadataManager.getChannelMetadata).toHaveBeenCalledWith('inventory-channel-1');
    expect(formatDataContent).toHaveBeenCalledWith(items, '備品リスト', 'inventory-channel-1', '日用品');
    expect(formatEmptyContent).not.toHaveBeenCalled();
    expect(buildInventoryComponents).toHaveBeenCalledWith('formatted inventory content');
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith({
      flags: MessageFlags.IsComponentsV2,
      components: inventoryComponents
    });
  });

  it('Given no inventory items When handle is called Then it restores empty inventory components', async () => {
    // Given
    const repository = {
      fetchAll: vi.fn().mockResolvedValue([])
    };
    const metadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue(null)
    };
    const formatDataContent = vi.spyOn(InventoryFormatter, 'formatDataContent');
    const formatEmptyContent = vi
      .spyOn(InventoryFormatter, 'formatEmptyContent')
      .mockResolvedValue('empty inventory content');
    vi.spyOn(InventoryFormatter, 'buildInventoryComponents').mockReturnValue(inventoryComponents as any);
    const handler = new InventorySelectionCancelButtonHandler(
      new Logger(),
      repository as any,
      metadataManager as any
    );
    const interaction = {
      customId: 'inventory_selection_cancel',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      update: vi.fn().mockResolvedValue(undefined)
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(formatEmptyContent).toHaveBeenCalledWith('在庫リスト', 'inventory-channel-1', undefined);
    expect(formatDataContent).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith({
      flags: MessageFlags.IsComponentsV2,
      components: inventoryComponents
    });
  });

  it('Given handler When checking logging behavior Then it skips operation logging', () => {
    // Given
    const handler = new InventorySelectionCancelButtonHandler(new Logger(), { fetchAll: vi.fn() } as any);

    // Then
    expect((handler as any).shouldSkipLogging()).toBe(true);
  });
});
