import { describe, expect, it, vi } from 'vitest';
import { AddListModalHandler } from '../../src/modals/AddListModalHandler';
import { EditListModalHandler } from '../../src/modals/EditListModalHandler';
import { InventoryUpdateModalHandler } from '../../src/modals/InventoryUpdateModalHandler';
import { InitListButtonHandler } from '../../src/buttons/InitListButtonHandler';
import { InventoryEditSession } from '../../src/utils/InventoryEditSession';
import { Logger } from '../../src/utils/logger';

describe.each(['add', 'edit', 'inventory', 'redraw'])('%s の完了返信', kind => {
  it.each(['success', 'failure', 'delete-failure'])('%s は成功返信だけを削除する', async outcome => {
    const write = outcome === 'failure' ? vi.fn().mockRejectedValue(new Error('保存失敗')) : vi.fn().mockResolvedValue({ itemCount: 1 });
    const repo = { snapshot: vi.fn().mockResolvedValue({ editVersion: '1', items: [] }), fetchAll: vi.fn().mockResolvedValue([]), save: write };
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { defaultCategory: '食品' } }) };
    const sessions = new InventoryEditSession();
    const token = sessions.open('1', '2', []);
    const logger = new Logger();
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const handler = kind === 'add' ? new AddListModalHandler(logger, repo as any, metadata as any)
      : kind === 'edit' ? new EditListModalHandler(logger, repo as any, metadata as any)
        : kind === 'inventory' ? new InventoryUpdateModalHandler(logger, { apply: write }, sessions)
          : new InitListButtonHandler(logger, undefined, metadata as any, { initializeList: write } as any);
    const interaction = {
      id: '3', channelId: '1', user: { id: '2' }, deferred: false, replied: false,
      customId: kind === 'add' ? 'add-list-modal' : kind === 'edit' ? 'edit-list-modal:1:2:1' : kind === 'inventory' ? `inventory_update_modal:${token}` : 'init-list-button',
      fields: { getTextInputValue: (key: string): string => key === 'category' ? '' : kind === 'inventory' ? ',牛乳,1,' : '牛乳' },
      deferReply: vi.fn(async () => { interaction.deferred = true; }),
      editReply: vi.fn(async () => { interaction.replied = true; }),
      deleteReply: outcome === 'delete-failure' ? vi.fn().mockRejectedValue(new Error('Discord unavailable')) : vi.fn(),
      fetchReply: vi.fn()
    };
    await handler.handle({ interaction } as any);
    expect(write).toHaveBeenCalledOnce();
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    if (outcome === 'failure') {
      expect(interaction.deleteReply).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: '保存失敗' });
    } else {
      expect(interaction.deleteReply).toHaveBeenCalledOnce();
    }
    expect(interaction.fetchReply).not.toHaveBeenCalled();
    if (outcome === 'delete-failure') expect(logger.warn).toHaveBeenCalled();
  });
});
