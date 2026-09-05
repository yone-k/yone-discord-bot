import { describe, it, expect, vi } from 'vitest';
import { InventoryUpdateModalHandler } from '../../src/modals/InventoryUpdateModalHandler';
import { InventoryEditSession } from '../../src/utils/InventoryEditSession';
import { Logger } from '../../src/utils/logger';
function setup(): any {
  const original = [{ id: 'a', name: 'A', stock: '1.23456789', category: '' }, { id: 'b', name: 'B', stock: '2', category: '' }];
  const sessions = new InventoryEditSession();
  const token = sessions.open('1', '2', original);
  const repo = { apply: vi.fn(), fetchAll: vi.fn().mockResolvedValue(original) };
  const messages = { createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true }) };
  const refresh = { refreshTasksUsingInventory: vi.fn() };
  const handler = new InventoryUpdateModalHandler(new Logger(), repo as any, messages as any, refresh as any, sessions);
  const interaction = { customId: `inventory_update_modal:${token}`, channelId: '1', user: { id: '2' }, client: {}, fields: { getTextInputValue: (): string => '1,改名,1.23456789,\n2,B,2,' } };
  return { original, repo, messages, refresh, handler, interaction };
}
describe('在庫編集原子的保存', () => {
  it('行番号対応の同じIDで改名しsnapshotと全件を一回で渡す', async () => { const s = setup(); const result = await s.handler.executeAction({ interaction: s.interaction }); expect(result.success).toBe(true); expect(s.repo.apply).toHaveBeenCalledOnce(); expect(s.repo.apply).toHaveBeenCalledWith('1', s.original, [{ ...s.original[0], name: '改名' }, s.original[1]]); });
  it('原子的保存失敗時に表示更新しない', async () => { const s = setup(); s.repo.apply.mockRejectedValue(new Error('参照中')); const result = await s.handler.executeAction({ interaction: s.interaction }); expect(result.success).toBe(false); expect(s.messages.createOrUpdateMessage).not.toHaveBeenCalled(); });
  it('別人のモーダルは保存しない', async () => { const s = setup(); s.interaction.user.id = '9'; expect((await s.handler.executeAction({ interaction: s.interaction })).success).toBe(false); expect(s.repo.apply).not.toHaveBeenCalled(); });
  it('期限切れ・旧モーダルは開き直しを案内する', async () => { const s = setup(); s.interaction.customId = 'inventory_update_modal'; expect((await s.handler.executeAction({ interaction: s.interaction })).message).toContain('開き直'); expect(s.repo.apply).not.toHaveBeenCalled(); });
});
