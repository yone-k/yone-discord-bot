import { describe, expect, it, vi } from 'vitest';
import { InventoryAddModalHandler } from '../../src/modals/InventoryAddModalHandler';
import { Logger } from '../../src/utils/logger';
import type { ModalSubmitInteraction } from 'discord.js';

interface Setup {
  service: { createMany: ReturnType<typeof vi.fn> };
  logger: Logger;
  interaction: { deferReply: ReturnType<typeof vi.fn>; editReply: ReturnType<typeof vi.fn>; deleteReply: ReturnType<typeof vi.fn> };
  run(): Promise<void>;
}
function setup(text = '洗剤,5\nパン,0.0000000000000000003', category = '', metadata: { defaultCategory: string } | null = { defaultCategory: '未分類' }): Setup {
  const service = { createMany: vi.fn().mockResolvedValue([]) };
  const logger = new Logger();
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  const handler = new InventoryAddModalHandler(logger, service, { getChannelMetadata: vi.fn().mockResolvedValue(metadata) });
  const interaction = { customId: 'inventory_add_modal', user: { id: '123' }, channelId: '100',
    fields: { getTextInputValue: vi.fn((field: string) => field === 'items' ? text : category) },
    deferReply: vi.fn(), editReply: vi.fn(), deleteReply: vi.fn() };
  return { service, logger, interaction, run: (): Promise<void> => handler.handle({ interaction: interaction as unknown as ModalSubmitInteraction }) };
}

describe('inventory add modal batch', () => {
  it.each(['日用品', ''])('submits once with unified category %s and exact quantities', async category => {
    const x = setup(undefined, category);
    await x.run();
    expect(x.interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(x.service.createMany).toHaveBeenCalledExactlyOnceWith('100', [
      { name: '洗剤', stock: '5', category: category || '未分類' },
      { name: 'パン', stock: '0.0000000000000000003', category: category || '未分類' }
    ]);
    expect(x.interaction.editReply).toHaveBeenCalledWith({ content: '処理が完了しました。' });
    expect(x.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it('uses empty category when no default exists', async () => {
    const x = setup('洗剤,5', '', null);
    await x.run();
    expect(x.service.createMany).toHaveBeenCalledWith('100', [{ name: '洗剤', stock: '5', category: '' }]);
  });
  it.each(['洗剤,abc', '  \n'])('rejects invalid local input without a write: %s', async input => {
    const x = setup(input);
    await x.run();
    expect(x.service.createMany).not.toHaveBeenCalled();
    expect(x.interaction.deleteReply).not.toHaveBeenCalled();
    expect(x.interaction.editReply).toHaveBeenCalled();
  });
  it('reports skipped names as warnings while retaining successful cleanup', async () => {
    const x = setup();
    x.service.createMany.mockResolvedValue(['洗剤']);
    await x.run();
    expect(x.service.createMany).toHaveBeenCalledOnce();
    expect(x.logger.warn).toHaveBeenCalledWith('Skipped inventory item', { name: '洗剤', message: '同名のアイテムが既に存在します' });
    expect(x.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it('does not replay a failed batch or announce completion', async () => {
    const x = setup();
    x.service.createMany.mockRejectedValue(new Error('response lost'));
    await x.run();
    expect(x.service.createMany).toHaveBeenCalledOnce();
    expect(x.interaction.deleteReply).not.toHaveBeenCalled();
    expect(x.interaction.editReply).not.toHaveBeenCalledWith({ content: '処理が完了しました。' });
  });
});
