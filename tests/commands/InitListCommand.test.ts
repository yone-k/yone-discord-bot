import { describe, it, expect, vi } from 'vitest';
import { InitListCommand } from '../../src/commands/InitListCommand';
import { Logger } from '../../src/utils/logger';
describe('init-list DB', () => {
  it('既存カテゴリとログ保持を初期化へ渡す', async () => {
    const meta = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { defaultCategory: '食品' } }) };
    const service = { initializeList: vi.fn().mockResolvedValue({ success: true, itemCount: 2 }) };
    const context = { channelId: '1', interaction: { options: { getString: (): null => null, getBoolean: (): null => null }, editReply: vi.fn() } };
    await new InitListCommand(new Logger(), meta as any, service as any).execute(context as any);
    expect(service.initializeList).toHaveBeenCalledWith(context, null, '食品');
    expect(context.interaction.editReply).toHaveBeenCalledWith({ content: '✅ 2件のアイテムを表示しました' });
  });
  it('新規カテゴリとログ無効指定を渡す', async () => {
    const meta = { getChannelMetadata: vi.fn().mockResolvedValue({ success: false }) };
    const service = { initializeList: vi.fn().mockResolvedValue({ success: true, itemCount: 0 }) };
    const context = { channelId: '1', interaction: { options: { getString: (): string => '家事', getBoolean: (): boolean => false }, editReply: vi.fn() } };
    await new InitListCommand(new Logger(), meta as any, service as any).execute(context as any);
    expect(service.initializeList).toHaveBeenCalledWith(context, false, '家事');
  });
});
