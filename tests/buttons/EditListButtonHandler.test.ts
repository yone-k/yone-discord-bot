import { describe, it, expect, vi } from 'vitest';
import { EditListButtonHandler } from '../../src/buttons/EditListButtonHandler';
import { Logger } from '../../src/utils/logger';
describe('一覧編集ボタン', () => {
  it('snapshotの版と本人を保持し空カテゴリを埋めない', async () => {
    const repo = { snapshot: vi.fn().mockResolvedValue({ editVersion: '9', items: [{ name: 'a', category: null, until: '2026-01-01', isCompleted: false }] }) };
    const showModal = vi.fn();
    const handler = new EditListButtonHandler(new Logger(), undefined, undefined, repo as any);
    await handler.handle({ interaction: { customId: 'edit-list-button', channelId: '123', user: { id: '456' }, showModal } } as any);
    const modal = showModal.mock.calls[0][0].toJSON();
    expect(modal.custom_id).toBe('edit-list-modal:123:456:9');
    expect(modal.components[0].components[0].value).toBe('a,,2026-01-01,');
  });
  it('空リストは保存すると実データになる例文を設定しない', async () => {
    const repo = { snapshot: vi.fn().mockResolvedValue({ editVersion: '0', items: [] }) };
    const showModal = vi.fn();
    await new EditListButtonHandler(new Logger(), undefined, undefined, repo as any).handle({ interaction: { customId: 'edit-list-button', channelId: '123', user: { id: '456' }, showModal } } as any);
    expect(showModal.mock.calls[0][0].toJSON().components[0].components[0].value).toBeUndefined();
  });
});
it('DB取得失敗は利用者に返信する', async () => {
  const repo = { snapshot: vi.fn().mockRejectedValue(new Error('DB unavailable')) };
  const interaction = { customId: 'edit-list-button', channelId: '123', user: { id: '456' }, showModal: vi.fn(), reply: vi.fn() };
  await new EditListButtonHandler(new Logger(), undefined, undefined, repo as any).handle({ interaction } as any);
  expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'DB unavailable' }));
});
