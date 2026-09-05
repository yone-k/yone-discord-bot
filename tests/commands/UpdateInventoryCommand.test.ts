import { describe, it, expect, vi } from 'vitest';
import { UpdateInventoryCommand } from '../../src/commands/UpdateInventoryCommand';
import { InventoryEditSession } from '../../src/utils/InventoryEditSession';
import { Logger } from '../../src/utils/logger';
describe('在庫更新コマンド', () => {
  it('コマンド入口から番号付きCSVと期限付き編集へ到達する', async () => {
    const items = [{ id: 'id', name: '牛乳', stock: '9007199254740993.123456789', category: '' }];
    const showModal = vi.fn();
    await new UpdateInventoryCommand(new Logger(), { fetchAll: async (): Promise<typeof items> => items }).execute({ channelId: '1', interaction: { user: { id: '2' }, showModal } } as any);
    const modal = showModal.mock.calls[0][0].toJSON();
    expect(modal.components[0].components[0].value).toBe('1,牛乳,9007199254740993.123456789,');
    expect(InventoryEditSession.shared.get(modal.custom_id.split(':')[1], '1', '2')).toEqual(items);
  });
  it('コンテキスト不備ではDBを取得しない', async () => { const fetchAll = vi.fn(); await expect(new UpdateInventoryCommand(new Logger(), { fetchAll }).execute()).rejects.toThrow(); expect(fetchAll).not.toHaveBeenCalled(); });
});
