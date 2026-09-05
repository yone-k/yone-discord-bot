import { describe, it, expect, vi } from 'vitest';
import { InventoryInitializationService } from '../../src/services/InventoryInitializationService';
describe('InventoryInitializationService', () => {
  it('registers a channel before rendering its persisted items', async () => {
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue(null), createChannelMetadata: vi.fn().mockResolvedValue({ success: true }) };
    const items = [{ id: 'i', name: '米', stock: '1.2', category: '' }];
    const messages = { createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true }) };
    const service = new InventoryInitializationService(metadata as any, messages as any, { fetchAll: vi.fn().mockResolvedValue(items) });
    await service.initializeInventory({ channelId: '123', listTitle: '在庫', client: {} as any });
    expect(metadata.createChannelMetadata).toHaveBeenCalledWith('123', { messageId: '', listTitle: '在庫', defaultCategory: '' });
    expect(messages.createOrUpdateMessage).toHaveBeenCalledWith('123', items, '在庫', {});
  });
  it('does not overwrite existing channel configuration on redraw', async () => {
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ channelId: '123' }), createChannelMetadata: vi.fn() };
    const messages = { createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true }) };
    const service = new InventoryInitializationService(metadata as any, messages as any, { fetchAll: vi.fn().mockResolvedValue([]) });
    await service.initializeInventory({ channelId: '123', listTitle: '在庫', client: {} as any });
    expect(metadata.createChannelMetadata).not.toHaveBeenCalled();
  });
});
