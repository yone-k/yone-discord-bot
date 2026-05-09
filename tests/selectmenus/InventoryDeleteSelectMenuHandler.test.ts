import { describe, expect, it, vi } from 'vitest';
import { InventoryDeleteSelectMenuHandler } from '../../src/selectmenus/InventoryDeleteSelectMenuHandler';
import { Logger } from '../../src/utils/logger';

describe('InventoryDeleteSelectMenuHandler', () => {
  it.each(['inventory_delete_select', 'inventory_delete_select_0'])(
    'Given selected inventory item and customId %s When handle is called Then it shows delete confirm modal',
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
      const handler = new InventoryDeleteSelectMenuHandler(new Logger(), repository as any);
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
      expect(modalJson.custom_id).toBe('inventory_delete_modal_inventory-1');
      expect(modalJson.title).toBe('在庫削除の確認');
      expect(modalJson.components[0].components[0].custom_id).toBe('confirm');
      expect(modalJson.components[0].components[0].label).toContain('YES');
    }
  );
});
