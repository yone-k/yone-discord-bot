import { describe, it, expect, vi } from 'vitest';
import { InitListButtonHandler } from '../../src/buttons/InitListButtonHandler';
import { Logger } from '../../src/utils/logger';
describe('一覧再描画ボタン', () => {
  it('初期化済み設定を保持しDBから再描画する', async () => {
    const meta = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { defaultCategory: '食品' } }) };
    const service = { initializeList: vi.fn().mockResolvedValue({ success: true, itemCount: 3 }) };
    const interaction = { customId: 'init-list-button', channelId: '1', user: { id: '2' }, deferReply: vi.fn(), editReply: vi.fn() };
    await new InitListButtonHandler(new Logger(), undefined, meta as any, service as any).handle({ interaction } as any);
    expect(service.initializeList).toHaveBeenCalledWith(expect.objectContaining({ channelId: '1' }), null, '食品', true);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '✅ リストを再描画しました' });
  });
  it('未初期化なら勝手に初期化しない', async () => {
    const meta = { getChannelMetadata: vi.fn().mockResolvedValue({ success: false }) };
    const service = { initializeList: vi.fn() };
    const interaction = { customId: 'init-list-button', channelId: '1', user: { id: '2' }, deferReply: vi.fn(), editReply: vi.fn() };
    await new InitListButtonHandler(new Logger(), undefined, meta as any, service as any).handle({ interaction } as any);
    expect(service.initializeList).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'リストが初期化されていません' });
  });
});
