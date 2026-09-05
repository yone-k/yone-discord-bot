import { describe, it, expect, vi } from 'vitest';
import { AddListModalHandler } from '../../src/modals/AddListModalHandler';
import { Logger } from '../../src/utils/logger';
const setup = (text = '牛乳,2026-01-01\nパン'): {
    repo: {
        snapshot: ReturnType<typeof vi.fn>;
        save: ReturnType<typeof vi.fn>;
        fetchAll: ReturnType<typeof vi.fn>;
    };
    messages: {
        createOrUpdateMessageWithMetadataV2: ReturnType<typeof vi.fn>;
    };
    handler: AddListModalHandler;
    context: any;
} => {
  const repo = { snapshot: vi.fn().mockResolvedValue({ editVersion: '4', items: [] }), save: vi.fn(), fetchAll: vi.fn().mockResolvedValue([]) };
  const messages = { createOrUpdateMessageWithMetadataV2: vi.fn().mockResolvedValue({ success: true }) };
  const meta = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { listTitle: '買物', defaultCategory: '食品' } }) };
  const handler = new AddListModalHandler(new Logger(), repo as any, messages as any, meta as any);
  const context = { interaction: { channelId: '1', fields: { getTextInputValue: (key: string) => key === 'items' ? text : '' }, client: {} } } as any;
  return { repo, messages, handler, context };
};
describe('一覧追加DB', () => {
  it('複数追加を一回の版付き保存で確定する', async () => { const { repo, handler, context } = setup(); expect((await (handler as any).executeAction(context)).success).toBe(true); expect(repo.save).toHaveBeenCalledOnce(); expect(repo.save.mock.calls[0]).toEqual(['1', '4', [{ name: '牛乳', category: null, until: '2026-01-01', isCompleted: false }, { name: 'パン', category: null, until: null, isCompleted: false }]]); });
  it.each(['牛乳,invalid\nパン', '牛乳\n牛乳'])('不正複数入力は全件拒否 %s', async (text) => { const { repo, handler, context } = setup(text); expect((await (handler as any).executeAction(context)).success).toBe(false); expect(repo.save).not.toHaveBeenCalled(); });
  it('既存名との重複も全件拒否する', async () => { const { repo, handler, context } = setup(); repo.snapshot.mockResolvedValue({ editVersion: '4', items: [{ name: '牛乳' }] } as any); expect((await (handler as any).executeAction(context)).success).toBe(false); expect(repo.save).not.toHaveBeenCalled(); });
  it('保存失敗後にDiscordを描画しない', async () => { const { repo, messages, handler, context } = setup(); repo.save.mockRejectedValue(new Error('offline')); expect((await (handler as any).executeAction(context)).success).toBe(false); expect(messages.createOrUpdateMessageWithMetadataV2).not.toHaveBeenCalled(); });
});
it('追加操作ログには対象アイテムを含める', async () => {
  const { handler, context } = setup('牛乳,2026-01-01');
  const result = await (handler as any).executeAction(context);
  expect(result.details.items).toEqual([{ name: '牛乳', category: 'その他', quantity: 1, until: new Date('2025-12-31T15:00:00Z') }]);
});
