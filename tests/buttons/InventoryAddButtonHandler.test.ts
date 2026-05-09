import { describe, expect, it, vi } from 'vitest';
import { InventoryAddButtonHandler } from '../../src/buttons/InventoryAddButtonHandler';
import { Logger } from '../../src/utils/logger';

describe('InventoryAddButtonHandler', () => {
  it('Given inventory add button When handle is called Then it shows inventory add modal', async () => {
    // Given
    const handler = new InventoryAddButtonHandler(new Logger());
    const interaction = {
      customId: 'inventory_add',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      showModal: vi.fn().mockResolvedValue(undefined)
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(handler.getCustomId()).toBe('inventory_add');
    expect(interaction.showModal).toHaveBeenCalledOnce();
    const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
    expect(modalJson.custom_id).toBe('inventory_add_modal');
    expect(modalJson.title).toBe('在庫アイテムを追加');
    expect(modalJson.components.map((row: any) => row.components[0].custom_id)).toEqual([
      'name',
      'stock',
      'category'
    ]);
  });
});
