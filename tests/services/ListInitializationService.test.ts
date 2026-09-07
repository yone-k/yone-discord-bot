import { describe, it, expect, vi } from 'vitest';
import { ListInitializationService } from '../../src/services/ListInitializationService';
describe('一覧初期化DB', () => {
  it.each([true, false, null])('ログ指定 %s を初期化予約へ渡し、未指定なら既存設定を保持する', async enableLog => {
    const repo = { fetchAll: vi.fn().mockResolvedValue([]) };
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ metadata: { listTitle: '既存', operationLogThreadId: '9' } }), updateChannelMetadata: vi.fn().mockResolvedValue({ success: true }) };
    const outputs = { initialize: vi.fn().mockResolvedValue({}), redraw: vi.fn() };
    await new ListInitializationService(repo as any, outputs, metadata as any).initializeList({ channelId: '1', interaction: { channel: { name: '買物' } } } as any, enableLog, '食品');
    expect(outputs.initialize).toHaveBeenCalledExactlyOnceWith('1', { kind: 'list', ...(enableLog === null ? {} : { enableLog }) });
    expect(metadata.updateChannelMetadata).toHaveBeenCalledExactlyOnceWith('1', { listTitle: '買物リスト', defaultCategory: '食品' });
    expect(outputs.redraw).not.toHaveBeenCalled();
  });
  it('設定を作成してから初期化を予約する', async () => {
    const order: string[] = [];
    const repo = { fetchAll: vi.fn().mockImplementation(async () => { order.push('read'); return []; }) };
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: false }), createChannelMetadata: vi.fn().mockImplementation(async () => { order.push('create'); return { success: true }; }), updateChannelMetadata: vi.fn().mockResolvedValue({ success: true }) };
    const outputs = { initialize: vi.fn().mockImplementation(async () => { order.push('reserve'); return { taskIds: [] }; }) };
    const result = await new ListInitializationService(repo as any, outputs as any, metadata as any).initializeList({ channelId: '1', interaction: { channel: { name: '買物' }, client: {} } } as any, false, '食品');
    expect(result.success).toBe(true);
    expect(order).toEqual(['create', 'reserve', 'read']);
    expect(metadata.createChannelMetadata).toHaveBeenCalledWith('1', expect.objectContaining({ defaultCategory: '食品' }));
  });
  it('件数読取失敗でも予約を維持し、件数を捏造しない', async () => {
    const repo = { fetchAll: vi.fn().mockRejectedValue(new Error('offline')) };
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { messageId: '9' } }), updateChannelMetadata: vi.fn().mockResolvedValue({ success: true }) };
    const outputs = { initialize: vi.fn() };
    await expect(new ListInitializationService(repo as any, outputs as any, metadata as any).initializeList({ channelId: '1', interaction: { channel: { name: '買物' }, client: {} } } as any, null, '食品')).rejects.toThrow();
    expect(outputs.initialize).toHaveBeenCalledExactlyOnceWith('1', { kind: 'list' });
  });
});
it('再描画では業務設定や版を更新しない', async () => {
  const repo = { fetchAll: vi.fn().mockResolvedValue([]) };
  const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { messageId: '9', listTitle: '保存タイトル', defaultCategory: '食品' } }), updateChannelMetadata: vi.fn() };
  const outputs = { initialize: vi.fn(), redraw: vi.fn().mockResolvedValue({}) };
  await new ListInitializationService(repo as any, outputs as any, metadata as any).initializeList({ channelId: '1', interaction: { channel: { name: '別名' }, client: {} } } as any, null, '食品', true);
  expect(metadata.updateChannelMetadata).not.toHaveBeenCalled();
  expect(outputs.redraw).toHaveBeenCalledExactlyOnceWith('1', 'list');
  expect(outputs.initialize).not.toHaveBeenCalled();
});
