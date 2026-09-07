import { describe, it, expect, vi } from 'vitest';
import { AddListModalHandler } from '../../src/modals/AddListModalHandler';
import { Logger } from '../../src/utils/logger';
const setup = (text = '牛乳,2026-01-01\nパン'): {
    repo: {
        snapshot: ReturnType<typeof vi.fn>;
        save: ReturnType<typeof vi.fn>;
        fetchAll: ReturnType<typeof vi.fn>;
    };
    handler: AddListModalHandler;
    context: any;
} => {
  const repo = { snapshot: vi.fn().mockResolvedValue({ editVersion: '4', items: [] }), save: vi.fn(), fetchAll: vi.fn().mockResolvedValue([]) };
  const meta = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { listTitle: '買物', defaultCategory: '食品' } }) };
  const handler = new AddListModalHandler(new Logger(), repo as any, meta as any);
  const context = { interaction: { channelId: '1', fields: { getTextInputValue: (key: string) => key === 'items' ? text : '' }, client: { channels: { fetch: vi.fn() } } } } as any;
  return { repo, handler, context };
};
describe('一覧追加DB', () => {
  it('保存成功後はTSから再描画せず成功を返す', async () => {
    const { repo, handler, context } = setup();
    context.interaction.client.channels.fetch.mockRejectedValue(new Error('Discord unavailable'));
    expect((await (handler as any).executeAction(context)).success).toBe(true);
    expect(repo.save).toHaveBeenCalledOnce();
    expect(repo.fetchAll).not.toHaveBeenCalled();
    expect(context.interaction.client.channels.fetch).not.toHaveBeenCalled();
  });
  it('複数追加を一回の版付き保存で確定する', async () => { const { repo, handler, context } = setup(); expect((await (handler as any).executeAction(context)).success).toBe(true); expect(repo.save).toHaveBeenCalledOnce(); expect(repo.save.mock.calls[0]).toEqual(['1', '4', [{ name: '牛乳', category: null, until: '2026-01-01', isCompleted: false }, { name: 'パン', category: null, until: null, isCompleted: false }]]); });
  it.each(['牛乳,invalid\nパン'])('不正複数入力は全件拒否 %s', async (text) => { const { repo, handler, context } = setup(text); expect((await (handler as any).executeAction(context)).success).toBe(false); expect(repo.save).not.toHaveBeenCalled(); });
  it('既存名との重複も全件拒否する', async () => { const { repo, handler, context } = setup(); repo.snapshot.mockResolvedValue({ editVersion: '4', items: [{ name: '牛乳' }] } as any); repo.save.mockRejectedValue(new Error('同名の項目があります')); expect((await (handler as any).executeAction(context)).success).toBe(false); expect(repo.save).toHaveBeenCalledOnce(); });
  it('保存失敗後にDiscordを描画しない', async () => { const { repo, handler, context } = setup(); repo.save.mockRejectedValue(new Error('offline')); expect((await (handler as any).executeAction(context)).success).toBe(false); expect(context.interaction.client.channels.fetch).not.toHaveBeenCalled(); });
});
it('追加操作ログには対象アイテムを含める', async () => {
  const { handler, context } = setup('牛乳,2026-01-01');
  const result = await (handler as any).executeAction(context);
  expect(result.details.items).toEqual([{ name: '牛乳', category: 'その他', quantity: 1, until: new Date('2025-12-31T15:00:00Z') }]);
});
