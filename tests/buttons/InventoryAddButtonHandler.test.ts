import { describe, expect, it, vi } from 'vitest';
import { TextInputStyle } from 'discord.js';
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
    expect(modalJson.title).toBe('在庫を追加');
    expect(modalJson.components).toHaveLength(2);

    const categoryInput = modalJson.components[0].components[0];
    expect(categoryInput.custom_id).toBe('category');
    expect(categoryInput.label).toBe('カテゴリー（省略可）');
    expect(categoryInput.style).toBe(TextInputStyle.Short);
    expect(categoryInput.required).toBe(false);
    expect(categoryInput.max_length).toBe(50);
    expect(categoryInput.placeholder).toBe('例: 食料品、日用品');

    const itemsInput = modalJson.components[1].components[0];
    expect(itemsInput.custom_id).toBe('items');
    expect(itemsInput.label).toBe('名前,在庫数（1行に1つ）');
    expect(itemsInput.style).toBe(TextInputStyle.Paragraph);
    expect(itemsInput.required).toBe(true);
    expect(itemsInput.max_length).toBe(4000);
    expect(itemsInput.placeholder).toBe('例:\n洗剤,5\nパン,3');
  });
});
