import { describe, expect, it, vi } from 'vitest';
import { InventoryDeleteButtonHandler } from '../../src/buttons/InventoryDeleteButtonHandler';
import { CoreApiError } from '../../src/api/CoreClient';
import { Logger } from '../../src/utils/logger';

interface InventoryButton {
  customId: string;
  channelId: string;
  user: { id: string; bot: boolean };
  deferred: boolean;
  reply: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  deferUpdate: ReturnType<typeof vi.fn>;
}

function interaction(customId = 'inventory_delete'): InventoryButton {
  return {
    customId, channelId: '100', user: { id: '200', bot: false }, deferred: false,
    reply: vi.fn(), update: vi.fn(), editReply: vi.fn(), followUp: vi.fn(),
    deferUpdate: vi.fn(async function (this: { deferred: boolean }) { this.deferred = true; })
  };
}

describe('InventoryDeleteButtonHandler', () => {
  it.each([
    ['inventory_delete', 0], ['inventory_delete?page=2', 2],
    ['inventory_delete?page=-1', 0], ['inventory_delete?page=abc', 0]
  ])('acknowledges before fetching and reserves page for %s', async (customId, page) => {
    const button = interaction(customId);
    const repository = { fetchAll: vi.fn(async () => {
      expect(button.deferUpdate).toHaveBeenCalledOnce();
      return [{ id: 'item-1' }];
    }) };
    const outputs = { setCardView: vi.fn().mockResolvedValue({}) };
    await new InventoryDeleteButtonHandler(new Logger(), repository as any, outputs as any).handle({ interaction: button } as any);
    expect(outputs.setCardView).toHaveBeenCalledExactlyOnceWith('100', 'inventory', '100', { mode: 'delete_selection', page });
    expect(button.update).not.toHaveBeenCalled();
    expect(button.editReply).not.toHaveBeenCalled();
    expect(button.followUp).not.toHaveBeenCalled();
  });

  it('reports an empty inventory privately without reserving a view', async () => {
    const button = interaction();
    const outputs = { setCardView: vi.fn() };
    await new InventoryDeleteButtonHandler(new Logger(), { fetchAll: vi.fn().mockResolvedValue([]) }, outputs as any).handle({ interaction: button } as any);
    expect(button.followUp).toHaveBeenCalledExactlyOnceWith({ content: '在庫アイテムがありません。', flags: ['Ephemeral'] });
    expect(outputs.setCardView).not.toHaveBeenCalled();
    expect(button.update).not.toHaveBeenCalled();
    expect(button.editReply).not.toHaveBeenCalled();
  });

  it.each(['fetch', 'reserve'])('reports %s errors privately without editing the shared card', async stage => {
    const button = interaction();
    const error = new CoreApiError('unavailable', 503);
    const repository = { fetchAll: stage === 'fetch' ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue([{ id: 'item-1' }]) };
    const outputs = { setCardView: vi.fn().mockRejectedValue(error) };
    await new InventoryDeleteButtonHandler(new Logger(), repository as any, outputs as any).handle({ interaction: button } as any);
    expect(button.followUp).toHaveBeenCalledExactlyOnceWith({ content: error.message, flags: ['Ephemeral'] });
    expect(button.update).not.toHaveBeenCalled();
    expect(button.editReply).not.toHaveBeenCalled();
  });

  it('retains custom IDs and ignores bots', () => {
    const handler = new InventoryDeleteButtonHandler(new Logger());
    expect(handler.getCustomId()).toBe('inventory_delete');
    expect(handler.shouldHandle({ interaction: interaction('inventory_delete?page=1') } as any)).toBe(true);
    expect(handler.shouldHandle({ interaction: { ...interaction(), user: { bot: true } } } as any)).toBe(false);
    expect(handler.shouldHandle({ interaction: interaction('other') } as any)).toBe(false);
  });
});
