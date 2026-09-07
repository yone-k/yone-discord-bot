import { describe, expect, it, vi } from 'vitest';
import { InventorySelectionCancelButtonHandler } from '../../src/buttons/InventorySelectionCancelButtonHandler';
import { CoreApiError } from '../../src/api/CoreClient';
import { Logger } from '../../src/utils/logger';

describe('InventorySelectionCancelButtonHandler output reservation', () => {
  it('acknowledges before reserving normal view without editing the shared card', async () => {
    const interaction = { channelId: '100', id: '888', customId: 'inventory_selection_cancel', user: { id: '999', bot: false }, deferUpdate: vi.fn().mockResolvedValue(undefined), update: vi.fn(), editReply: vi.fn() };
    const outputs = { setCardView: vi.fn().mockImplementation(async () => { expect(interaction.deferUpdate).toHaveBeenCalledOnce(); return {}; }) };
    const handler = new InventorySelectionCancelButtonHandler(new Logger(), outputs);
    await handler.handle({ interaction } as any);
    expect(outputs.setCardView).toHaveBeenCalledWith('100', 'inventory', '100', { mode: 'normal', page: 0 });
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
  it('reports an API failure ephemerally without changing the shared card', async () => {
    const interaction = { channelId: '100', id: '888', customId: 'inventory_selection_cancel', user: { id: '999', bot: false }, deferUpdate: vi.fn(), followUp: vi.fn(), editReply: vi.fn() };
    const outputs = { setCardView: vi.fn().mockRejectedValue(new CoreApiError('unavailable', 503, true)) };
    await new InventorySelectionCancelButtonHandler(new Logger(), outputs).handle({ interaction } as any);
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ flags: ['Ephemeral'] }));
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
  it('retains the custom ID and ignores bot users', () => {
    const handler = new InventorySelectionCancelButtonHandler(new Logger());
    expect(handler.getCustomId()).toBe('inventory_selection_cancel');
    expect(handler.shouldHandle({ interaction: { customId: 'inventory_selection_cancel', user: { bot: true } } } as any)).toBe(false);
    expect(handler.shouldHandle({ interaction: { customId: 'inventory_selection_cancel', user: { bot: false } } } as any)).toBe(true);
  });
});
