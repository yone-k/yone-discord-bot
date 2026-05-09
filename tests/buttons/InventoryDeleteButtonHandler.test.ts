import { describe, expect, it, vi } from 'vitest';
import { InventoryDeleteButtonHandler } from '../../src/buttons/InventoryDeleteButtonHandler';
import type { InventoryItem } from '../../src/models/InventoryItem';
import { Logger } from '../../src/utils/logger';

const createInventoryItems = (count: number): InventoryItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `inventory-${index + 1}`,
    name: `在庫${index + 1}`,
    stock: index + 1,
    category: index % 2 === 0 ? '日用品' : '食品'
  }));

const findSelectMenu = (replyPayload: any): any =>
  replyPayload.components
    .flatMap((row: any) => row.components)
    .find((component: any) => component.type === 3);

const findButtonByLabel = (replyPayload: any, label: string): any =>
  replyPayload.components
    .flatMap((row: any) => row.components)
    .find((component: any) => component.label === label);

describe('InventoryDeleteButtonHandler', () => {
  it('Given inventory items When handle is called Then it replies delete select menu', async () => {
    // Given
    const items = createInventoryItems(2);
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(items)
    };
    const handler = new InventoryDeleteButtonHandler(new Logger(), repository as any);
    const interaction = {
      customId: 'inventory_delete',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      reply: vi.fn().mockResolvedValue(undefined)
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(handler.getCustomId()).toBe('inventory_delete');
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(interaction.reply).toHaveBeenCalledOnce();
    const replyPayload = interaction.reply.mock.calls[0][0];
    const selectMenu = findSelectMenu(replyPayload);
    expect(replyPayload.flags).toEqual(['Ephemeral']);
    expect(selectMenu.custom_id).toBe('inventory_delete_select_0');
    expect(selectMenu.placeholder).toContain('削除');
    expect(selectMenu.options).toEqual([
      expect.objectContaining({ label: '在庫1', value: 'inventory-1' }),
      expect.objectContaining({ label: '在庫2', value: 'inventory-2' })
    ]);
  });

  it('Given no inventory items When handle is called Then it replies item empty error', async () => {
    // Given
    const repository = {
      fetchAll: vi.fn().mockResolvedValue([])
    };
    const handler = new InventoryDeleteButtonHandler(new Logger(), repository as any);
    const interaction = {
      customId: 'inventory_delete',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      reply: vi.fn().mockResolvedValue(undefined)
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('アイテムがありません'),
      flags: ['Ephemeral']
    });
  });

  it('Given more than 25 inventory items When handle is called Then it replies first page and next page button', async () => {
    // Given
    const repository = {
      fetchAll: vi.fn().mockResolvedValue(createInventoryItems(26))
    };
    const handler = new InventoryDeleteButtonHandler(new Logger(), repository as any);
    const interaction = {
      customId: 'inventory_delete',
      user: { id: 'user-1', bot: false },
      channelId: 'inventory-channel-1',
      reply: vi.fn().mockResolvedValue(undefined)
    };

    // When
    await handler.handle({ interaction } as any);

    // Then
    const replyPayload = interaction.reply.mock.calls[0][0];
    const selectMenu = findSelectMenu(replyPayload);
    const nextButton = findButtonByLabel(replyPayload, '次へ');
    expect(selectMenu.options).toHaveLength(25);
    expect(selectMenu.options[0]).toEqual(expect.objectContaining({ value: 'inventory-1' }));
    expect(selectMenu.options[24]).toEqual(expect.objectContaining({ value: 'inventory-25' }));
    expect(nextButton).toEqual(expect.objectContaining({
      custom_id: 'inventory_delete?page=1'
    }));
  });
});
