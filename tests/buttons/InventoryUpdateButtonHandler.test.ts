import { describe, it, expect, vi } from 'vitest';
import { InventoryUpdateButtonHandler } from '../../src/buttons/InventoryUpdateButtonHandler';
import { InventoryEditSession } from '../../src/utils/InventoryEditSession';
import { Logger } from '../../src/utils/logger';
describe('在庫編集ボタン', () => {
  it('番号付きCSVと本人snapshotを同じ編集画面に結ぶ', async () => {
    const items = [{ id: 'uuid', name: '牛乳', stock: '1.23456789', category: '' }];
    const repo = { fetchAll: vi.fn().mockResolvedValue(items) };
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ defaultCategory: '食品' }) };
    const showModal = vi.fn();
    await new InventoryUpdateButtonHandler(new Logger(), repo, undefined, undefined, metadata as any).handle({ interaction: { customId: 'inventory_update', channelId: '1', user: { id: '2' }, showModal } } as any);
    const modal = showModal.mock.calls[0][0].toJSON();
    expect(modal.components[0].components[0].value).toBe('1,牛乳,1.23456789,');
    expect(InventoryEditSession.shared.get(modal.custom_id.split(':')[1], '1', '2')).toEqual(items);
  });
  it('カテゴリ表示順を変えても元の番号対応を保持する', async () => {
    const items = [{ id: 'a', name: '洗剤', stock: '1', category: '日用品' }, { id: 'b', name: '米', stock: '2', category: '食品' }];
    const showModal = vi.fn();
    await new InventoryUpdateButtonHandler(new Logger(), { fetchAll: async (): Promise<typeof items> => items }, undefined, undefined, { getChannelMetadata: async (): Promise<null> => null }).handle({ interaction: { customId: 'inventory_update', channelId: '1', user: { id: '2' }, showModal } } as any);
    expect(showModal.mock.calls[0][0].toJSON().components[0].components[0].value).toBe('2,米,2,食品\n1,洗剤,1,日用品');
  });
  it('空一覧には実データ例を入力しない', async () => {
    const showModal = vi.fn();
    await new InventoryUpdateButtonHandler(new Logger(), { fetchAll: async (): Promise<never[]> => [] }, undefined, undefined, { getChannelMetadata: async (): Promise<null> => null }).handle({ interaction: { customId: 'inventory_update', channelId: '1', user: { id: '2' }, showModal } } as any);
    expect(showModal.mock.calls[0][0].toJSON().components[0].components[0].value).toBeUndefined();
  });
});
