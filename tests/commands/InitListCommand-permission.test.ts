import { describe, it, expect, vi } from 'vitest';
import { InitListCommand } from '../../src/commands/InitListCommand';
import { Logger } from '../../src/utils/logger';
describe('一覧初期化失敗', () => {
  it('チャンネルのない実行はDBへ到達しない', async () => {
    const meta = { getChannelMetadata: vi.fn() };
    const service = { initializeList: vi.fn() };
    await expect(new InitListCommand(new Logger(), meta as any, service as any).execute()).rejects.toThrow();
    expect(meta.getChannelMetadata).not.toHaveBeenCalled();
  });
  it('DB接続失敗は成功表示しない', async () => {
    const meta = { getChannelMetadata: vi.fn().mockRejectedValue(new Error('DB unavailable')) };
    const reply = vi.fn();
    await expect(new InitListCommand(new Logger(), meta as any, {} as any).execute({ channelId: '1', interaction: { options: { getString: () => null }, editReply: reply } } as any)).rejects.toThrow('DB unavailable');
    expect(reply).not.toHaveBeenCalled();
  });
});
