import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../../src/services/InventoryService';
import { CoreApiError } from '../../src/api/CoreClient';
function setup(): any {
  const item = { id: 'backend-id', name: '米', stock: '0.123456789', category: '' };
  const inventory = { resolveByName: vi.fn().mockResolvedValue(item), findById: vi.fn().mockResolvedValue(item), append: vi.fn().mockResolvedValue({ success: true }), update: vi.fn().mockResolvedValue({ success: true }), delete: vi.fn() };
  const service = new InventoryService(inventory);
  return { item, inventory, service };
}
describe('inventory API display adapter', () => {
  it('uses the backend identity and exact stock when resolving a name', async () => {
    const x = setup();
    expect(await x.service.resolveByName('channel', '米')).toEqual(x.item);
    expect(x.inventory.resolveByName).toHaveBeenCalledWith('channel', '米');
  });
  it('forwards writes and propagates authoritative domain errors', async () => {
    const x = setup();
    x.inventory.append.mockRejectedValue(new CoreApiError('conflict', 409));
    await expect(x.service.create('channel', x.item)).rejects.toMatchObject({ code: 'conflict' });
    expect(x.inventory.append).toHaveBeenCalledWith('channel', x.item);
  });
  it('lets the backend guard references when deleting inventory', async () => {
    const x = setup();
    x.inventory.delete.mockRejectedValue(new CoreApiError('referenced', 409));
    await expect(x.service.delete('channel', x.item.id)).rejects.toMatchObject({ code: 'referenced' });
  });
});
