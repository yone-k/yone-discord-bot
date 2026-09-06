import { describe, it, expect, vi } from 'vitest';
import { EditListModalHandler } from '../../src/modals/EditListModalHandler';
import { Logger } from '../../src/utils/logger';
import { RepositoryError } from '../../src/api/contracts';
const setup = (customId = 'edit-list-modal:123:456:7', text = '牛乳,,,'): {
    repo: {
        save: ReturnType<typeof vi.fn>;
        fetchAll: ReturnType<typeof vi.fn>;
    };
    handler: EditListModalHandler;
    context: any;
    messages: {
        createOrUpdateMessageWithMetadataV2: ReturnType<typeof vi.fn>;
    };
} => {
  const repo = { save: vi.fn(), fetchAll: vi.fn().mockResolvedValue([]) };
  const messages = { createOrUpdateMessageWithMetadataV2: vi.fn().mockResolvedValue({ success: true }) };
  const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { listTitle: 'リスト', defaultCategory: 'その他' } }) };
  const handler = new EditListModalHandler(new Logger(), repo as any, messages as any, metadata as any);
  const context = { interaction: { customId, channelId: '123', user: { id: '456' }, fields: { getTextInputValue: () => text }, client: {} } } as any;
  return { repo, handler, context, messages };
};
describe('編集モーダルDB保存', () => {
  it('開いた版を保存に渡す', async () => { const { repo, handler, context } = setup(); expect((await (handler as any).executeAction(context)).success).toBe(true); expect(repo.save).toHaveBeenCalledWith('123', '7', [{ name: '牛乳', category: null, until: null, isCompleted: false }]); });
  it('競合は再読込を促し再保存しない', async () => { const { repo, handler, context, messages } = setup(); repo.save.mockRejectedValue(new RepositoryError('conflict', 409)); const result = await (handler as any).executeAction(context); expect(result.success).toBe(false); expect(result.message).toContain('開き直'); expect(messages.createOrUpdateMessageWithMetadataV2).not.toHaveBeenCalled(); });
  it.each(['edit-list-modal:123:999:7', 'edit-list-modal:999:456:7', 'edit-list-modal'])('他人・別チャンネル・旧モーダルは拒否 %s', async (id) => { const { repo, handler, context } = setup(id); expect((await (handler as any).executeAction(context)).success).toBe(false); expect(repo.save).not.toHaveBeenCalled(); });
  it('APIによる重複拒否を表示し再送しない', async () => { const { repo, handler, context } = setup(undefined, '牛乳,,,\n牛乳,,,'); repo.save.mockRejectedValue(new RepositoryError('invalid_input', 422)); expect((await (handler as any).executeAction(context)).success).toBe(false); expect(repo.save).toHaveBeenCalledOnce(); });
  it('空は全削除として保存する', async () => { const { repo, handler, context } = setup(undefined, ''); expect((await (handler as any).executeAction(context)).success).toBe(true); expect(repo.save).toHaveBeenCalledWith('123', '7', []); });
});
it('ボタンで開いたCSVをモーダル送信から保存・再描画する', async () => {
  const { EditListButtonHandler } = await import('../../src/buttons/EditListButtonHandler');
  const repo = { snapshot: vi.fn().mockResolvedValue({ editVersion: '9007199254740993', items: [{ name: '牛乳', category: null, until: '2026-01-01', isCompleted: false }] }), save: vi.fn(), fetchAll: vi.fn().mockResolvedValue([{ name: '牛乳', category: null, until: '2026-01-01', isCompleted: true }]) };
  const showModal = vi.fn();
  await new EditListButtonHandler(new Logger(), undefined, undefined, repo as any).handle({ interaction: { customId: 'edit-list-button', channelId: '123', user: { id: '456' }, showModal } } as any);
  const customId = showModal.mock.calls[0][0].toJSON().custom_id;
  const messages = { createOrUpdateMessageWithMetadataV2: vi.fn().mockResolvedValue({ success: true }) };
  const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { listTitle: '買物', defaultCategory: '食品' } }) };
  const interaction = { customId, channelId: '123', user: { id: '456' }, fields: { getTextInputValue: (): string => '牛乳,,2026-01-01,1' }, client: {}, deferReply: vi.fn(), editReply: vi.fn() };
  await new EditListModalHandler(new Logger(), repo as any, messages as any, metadata as any).handle({ interaction } as any);
  expect(repo.save).toHaveBeenCalledWith('123', '9007199254740993', [{ name: '牛乳', category: null, until: '2026-01-01', isCompleted: true }]);
  const components = messages.createOrUpdateMessageWithMetadataV2.mock.calls[0][1];
  expect(JSON.stringify(components)).toContain('~~牛乳 (期限: 1/1)~~');
  expect(interaction.editReply).toHaveBeenCalledWith({ content: '✅ リストを更新しました' });
});
it('追加・削除・完了変更の操作ログ詳細を返す', async () => {
  const { repo, handler, context } = setup(undefined, '牛乳,,,1\nパン,,,');
  repo.fetchAll.mockResolvedValue([{ name: '牛乳', category: null, until: null, isCompleted: false }, { name: '卵', category: null, until: null, isCompleted: false }]);
  const result = await (handler as any).executeAction(context);
  expect(result.details.changes.added.map((x: any) => x.name)).toEqual(['パン']);
  expect(result.details.changes.removed.map((x: any) => x.name)).toEqual(['卵']);
  expect(result.details.changes.modified[0]).toEqual(expect.objectContaining({ name: '牛乳', before: expect.objectContaining({ check: false }), after: expect.objectContaining({ check: true }) }));
});
