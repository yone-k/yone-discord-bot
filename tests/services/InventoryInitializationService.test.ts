import { describe, it, expect, vi } from 'vitest';
import { InventoryInitializationService } from '../../src/services/InventoryInitializationService';
describe('InventoryInitializationService', () => {
  it('registers a channel before reserving initialization', async () => {
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue(null), createChannelMetadata: vi.fn().mockResolvedValue({ success: true }) };
    const outputs = { initialize: vi.fn().mockResolvedValue({}) };
    const service = new InventoryInitializationService(metadata as any, outputs as any);
    await service.initializeInventory({ channelId: '123', listTitle: '在庫' });
    expect(metadata.createChannelMetadata).toHaveBeenCalledWith('123', { listTitle: '在庫', defaultCategory: 'その他' });
    expect(outputs.initialize).toHaveBeenCalledExactlyOnceWith('123', { kind: 'inventory' });
    expect(metadata.createChannelMetadata.mock.invocationCallOrder[0]).toBeLessThan(outputs.initialize.mock.invocationCallOrder[0]);
  });
  it('does not overwrite existing channel configuration on redraw', async () => {
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ channelId: '123' }), createChannelMetadata: vi.fn() };
    const outputs = { initialize: vi.fn().mockResolvedValue({}) };
    const service = new InventoryInitializationService(metadata as any, outputs as any);
    await service.initializeInventory({ channelId: '123', listTitle: '在庫' });
    expect(metadata.createChannelMetadata).not.toHaveBeenCalled();
  });
});
