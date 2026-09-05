import { describe, it, expect, vi } from 'vitest';
import { InventoryRepository } from '../../src/services/InventoryRepository';
import type { InventoryRepository as Port } from '../../src/repositories/contracts';
describe('InventoryRepository domain conversion', () => {
  it('preserves stored precision and default-category following', async () => {
    const db = { fetchAll: vi.fn().mockResolvedValue([{ channelId: '123', id: 'x', name: '米', stock: '1.1234567890123456789', category: null, position: 0 }]) };
    expect(await new InventoryRepository(db as unknown as Port).fetchAll('123')).toEqual([{ id: 'x', name: '米', stock: '1.1234567890123456789', category: '' }]);
  });
  it('propagates database referential protection errors', async () => {
    const db = { delete: vi.fn().mockRejectedValue(new Error('referenced')) };
    await expect(new InventoryRepository(db as unknown as Port).delete('123', 'x')).rejects.toThrow('referenced');
  });
});
