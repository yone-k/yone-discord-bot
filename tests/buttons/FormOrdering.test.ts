import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreClient } from '../../src/api/CoreClient';
import { EditListButtonHandler } from '../../src/buttons/EditListButtonHandler';
import { InventoryUpdateButtonHandler } from '../../src/buttons/InventoryUpdateButtonHandler';
import { UpdateInventoryCommand } from '../../src/commands/UpdateInventoryCommand';
import { InventoryEditSession } from '../../src/utils/InventoryEditSession';
import { Logger } from '../../src/utils/logger';
import type { InventoryItem } from '../../src/models/InventoryItem';
import { delayedFetch, formInteraction } from '../helpers/FormInteraction';

describe('フォームの設定読取とカテゴリ・名前順', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const items = [
    { id: 'z', name: 'z', stock: '1', category: 'A', until: null, isCompleted: false },
    { id: 'b', name: 'b', stock: '2', category: '', until: null, isCompleted: false },
    { id: 'a', name: 'a', stock: '3', category: 'A', until: null, isCompleted: false }
  ];
  const csv = (interaction: ReturnType<typeof formInteraction>): string => (interaction.showModal.mock.calls[0] as any)[0].toJSON().components[0].components[0].value;
  it.each(['list', 'inventory'])('%s の設定と一覧を並行取得し1.5秒で表示する', async entry => {
    vi.useFakeTimers();
    const body = entry === 'list' ? { success: true, metadata: { defaultCategory: 'A' } } : { defaultCategory: 'A' };
    const fetcher = delayedFetch({ '/items': { delay: 1500, body: entry === 'list' ? { items, editVersion: '9' } : items }, '/settings': { delay: 1500, body } });
    const client = new CoreClient('https://test.invalid', 'test', fetcher);
    const metadata = { getChannelMetadata: (): Promise<unknown> => client.request('GET', '/settings') };
    const interaction = formInteraction(entry === 'list' ? 'edit-list-button' : '');
    const pending = entry === 'list'
      ? new EditListButtonHandler(new Logger(), undefined, metadata as any, { snapshot: (): Promise<unknown> => client.request('GET', '/items') } as any).handle({ interaction } as any)
      : new UpdateInventoryCommand(new Logger(), { fetchAll: (): Promise<InventoryItem[]> => client.request('GET', '/items') }, metadata as any).safeExecute({ interaction, channelId: interaction.channelId } as any);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1499);
    expect(interaction.showModal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(csv(interaction)).toBe(entry === 'list' ? 'a,A,,\nb,,,\nz,A,,' : '3,a,3,A\n2,b,2,\n1,z,1,A');
  });
  it.each(['list', 'inventory'])('%s は設定だけ期限超過しても取得済み一覧で表示する', async entry => {
    vi.useFakeTimers();
    const fetcher = delayedFetch({ '/items': { delay: 100, body: entry === 'list' ? { items, editVersion: '9' } : items }, '/settings': { delay: 2500, body: null } });
    const client = new CoreClient('https://test.invalid', 'test', fetcher);
    const metadata = { getChannelMetadata: (): Promise<unknown> => client.request('GET', '/settings') };
    const interaction = formInteraction(entry === 'list' ? 'edit-list-button' : '');
    const pending = entry === 'list'
      ? new EditListButtonHandler(new Logger(), undefined, metadata as any, { snapshot: (): Promise<unknown> => client.request('GET', '/items') } as any).handle({ interaction } as any)
      : new UpdateInventoryCommand(new Logger(), { fetchAll: (): Promise<InventoryItem[]> => client.request('GET', '/items') }, metadata as any).safeExecute({ interaction, channelId: interaction.channelId } as any);
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(csv(interaction)).toBe(entry === 'list' ? 'a,A,,\nz,A,,\nb,,,' : '3,a,3,A\n1,z,1,A\n2,b,2,');
  });
  it.each([null, {}, { defaultCategory: '' }, { defaultCategory: ' ' }, new Error('offline')])('在庫の両入口で設定不備 %j のフォールバックと番号対応を揃える', async settings => {
    const metadata = { getChannelMetadata: settings instanceof Error ? vi.fn().mockRejectedValue(settings) : vi.fn().mockResolvedValue(settings) };
    const button = formInteraction('inventory_update');
    const command = formInteraction('');
    const repository = { fetchAll: vi.fn().mockResolvedValue(items) };
    await new InventoryUpdateButtonHandler(new Logger(), repository, undefined, undefined, metadata as any).handle({ interaction: button } as any);
    await new UpdateInventoryCommand(new Logger(), repository, metadata as any).execute({ interaction: command, channelId: command.channelId } as any);
    expect(csv(button)).toBe('3,a,3,A\n1,z,1,A\n2,b,2,');
    expect(csv(command)).toBe(csv(button));
    for (const interaction of [button, command]) {
      const token = (interaction.showModal.mock.calls[0] as any)[0].toJSON().custom_id.split(':')[1];
      expect(InventoryEditSession.shared.get(token, interaction.channelId, interaction.user.id)).toEqual(items);
    }
  });
  it('在庫の両入口で有効な既定カテゴリを使い同じ順序にする', async () => {
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ defaultCategory: 'A' }) };
    const repository = { fetchAll: vi.fn().mockResolvedValue(items) };
    const button = formInteraction('inventory_update');
    const command = formInteraction('');
    await new InventoryUpdateButtonHandler(new Logger(), repository, undefined, undefined, metadata as any).handle({ interaction: button } as any);
    await new UpdateInventoryCommand(new Logger(), repository, metadata as any).execute({ interaction: command, channelId: command.channelId } as any);
    expect(csv(button)).toBe('3,a,3,A\n2,b,2,\n1,z,1,A');
    expect(csv(command)).toBe(csv(button));
  });
  it.each([{ success: false }, { success: true }, { success: true, metadata: {} }, { success: true, metadata: { defaultCategory: ' ' } }, new Error('offline')])('通常リストの設定不備 %j は空カテゴリを変更しない', async settings => {
    const metadata = { getChannelMetadata: settings instanceof Error ? vi.fn().mockRejectedValue(settings) : vi.fn().mockResolvedValue(settings) };
    const interaction = formInteraction('edit-list-button');
    await new EditListButtonHandler(new Logger(), undefined, metadata as any, { snapshot: vi.fn().mockResolvedValue({ items, editVersion: '9' }) } as any).handle({ interaction } as any);
    expect(csv(interaction)).toBe('a,A,,\nz,A,,\nb,,,');
  });
  it.each(['list', 'inventory'])('%s の一覧取得失敗を空一覧として扱わない', async entry => {
    const interaction = formInteraction(entry === 'list' ? 'edit-list-button' : '');
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue(null) };
    const read = vi.fn().mockRejectedValue(new Error('items unavailable'));
    if (entry === 'list') {
      await new EditListButtonHandler(new Logger(), undefined, metadata as any, { snapshot: read } as any).handle({ interaction } as any);
      expect(interaction.reply).toHaveBeenCalledOnce();
    } else {
      const result = await new UpdateInventoryCommand(new Logger(), { fetchAll: read }, metadata as any).safeExecute({ interaction, channelId: interaction.channelId } as any);
      expect(result.success).toBe(false);
    }
    expect(interaction.showModal).not.toHaveBeenCalled();
  });
});
