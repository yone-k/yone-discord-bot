import { describe, it, expect, vi } from 'vitest';
import { ListInitializationService } from '../../src/services/ListInitializationService';
describe('一覧初期化DB', () => {
  it('設定を作成してから読取・Discord表示する', async () => {
    const order: string[] = [];
    const repo = { fetchAll: vi.fn().mockImplementation(async () => { order.push('read'); return []; }) };
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: false }), createChannelMetadata: vi.fn().mockImplementation(async () => { order.push('create'); return { success: true }; }), updateChannelMetadata: vi.fn().mockResolvedValue({ success: true }) };
    const messages = { createOrUpdateMessageWithMetadataV2: vi.fn().mockImplementation(async () => { order.push('discord'); return { success: true, message: { id: '9' } }; }) };
    const result = await new ListInitializationService(repo as any, messages as any, metadata as any).initializeList({ channelId: '1', interaction: { channel: { name: '買物' }, client: {} } } as any, false, '食品');
    expect(result.success).toBe(true);
    expect(order).toEqual(['create', 'read', 'discord']);
    expect(metadata.createChannelMetadata).toHaveBeenCalledWith('1', expect.objectContaining({ messageId: '', defaultCategory: '食品' }));
  });
  it('DB読取失敗を空リストとして描画しない', async () => {
    const repo = { fetchAll: vi.fn().mockRejectedValue(new Error('offline')) };
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { messageId: '9' } }), updateChannelMetadata: vi.fn().mockResolvedValue({ success: true }) };
    const messages = { createOrUpdateMessageWithMetadataV2: vi.fn() };
    await expect(new ListInitializationService(repo as any, messages as any, metadata as any).initializeList({ channelId: '1', interaction: { channel: { name: '買物' }, client: {} } } as any, null, '食品')).rejects.toThrow();
    expect(messages.createOrUpdateMessageWithMetadataV2).not.toHaveBeenCalled();
  });
});
it('再描画では業務設定や版を更新しない', async () => {
  const repo = { fetchAll: vi.fn().mockResolvedValue([]) };
  const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { messageId: '9', listTitle: '保存タイトル', defaultCategory: '食品' } }), updateChannelMetadata: vi.fn() };
  const messages = { createOrUpdateMessageWithMetadataV2: vi.fn().mockResolvedValue({ success: true, message: { id: '9' } }) };
  await new ListInitializationService(repo as any, messages as any, metadata as any).initializeList({ channelId: '1', interaction: { channel: { name: '別名' }, client: {} } } as any, null, '食品', true);
  expect(metadata.updateChannelMetadata).not.toHaveBeenCalled();
  expect(messages.createOrUpdateMessageWithMetadataV2).toHaveBeenCalledWith('1', expect.anything(), '保存タイトル', expect.anything(), 'list');
});
