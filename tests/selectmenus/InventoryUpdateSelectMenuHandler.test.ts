import { describe, expect, it, vi } from 'vitest';
import { InventoryUpdateSelectMenuHandler } from '../../src/selectmenus/InventoryUpdateSelectMenuHandler';
import { Logger } from '../../src/utils/logger';

describe('InventoryUpdateSelectMenuHandler', () => {
  it.each(['inventory_update_select', 'inventory_update_select_0'])(
    'Given selected inventory item and customId %s When handle is called Then it shows prefilled update modal',
    async (customId) => {
      // Given
      const repository = {
        findById: vi.fn().mockResolvedValue({
          id: 'inventory-1',
          name: '洗剤',
          stock: 5,
          category: '日用品'
        })
      };
      const handler = new InventoryUpdateSelectMenuHandler(new Logger(), repository as any);
      const interaction = {
        customId,
        user: { id: 'user-1', bot: false },
        channelId: 'inventory-channel-1',
        values: ['inventory-1'],
        showModal: vi.fn().mockResolvedValue(undefined)
      };

      // When
      await handler.handle({ interaction } as any);

      // Then
      expect(repository.findById).toHaveBeenCalledWith('inventory-channel-1', 'inventory-1');
      expect(interaction.showModal).toHaveBeenCalledOnce();
      const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
      expect(modalJson.custom_id).toBe('inventory_update_modal_inventory-1');
      expect(modalJson.title).toBe('在庫を更新');
      expect(modalJson.components.map((row: any) => row.components[0].value)).toEqual([
        '洗剤',
        '5',
        '日用品'
      ]);
    }
  );
});
