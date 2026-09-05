import { vi } from 'vitest';
import { InventoryRepository as InventoryAdapter } from '../../src/services/InventoryRepository';
import { InventoryUpdateButtonHandler } from '../../src/buttons/InventoryUpdateButtonHandler';
import { InventoryUpdateModalHandler } from '../../src/modals/InventoryUpdateModalHandler';
import { InventoryMessageManager } from '../../src/services/InventoryMessageManager';
import { InventoryChannelStore } from '../../src/services/InventoryChannelStore';
import { InventoryEditSession } from '../../src/utils/InventoryEditSession';
import { closePool } from '../../src/db/pool';
import { Logger } from '../../src/utils/logger';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { testPool, resetDatabase } from './helpers';
import { applyMigrations } from '../../src/db/schema';
import { PostgresInventoryRepository } from '../../src/repositories/PostgresInventoryRepository';
import { PostgresInventoryChannelRepository } from '../../src/repositories/PostgresInventoryChannelRepository';
import { PostgresRemindTaskRepository } from '../../src/repositories/PostgresRemindTaskRepository';
import { PostgresRemindChannelRepository } from '../../src/repositories/PostgresRemindChannelRepository';
describe('在庫CSVの原子的適用', () => {
  const pool = testPool(), repo = new PostgresInventoryRepository(pool);
  beforeAll(async () => { await resetDatabase(pool); await applyMigrations(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE inventory_channels,remind_channels CASCADE');
    await new PostgresInventoryChannelRepository(pool).save({ channelId: '1', messageId: null, listTitle: '在庫', defaultCategory: '食品', operationLogThreadId: null });
    await repo.append('1', { id: 'a', name: 'A', stock: '9007199254740993.123456789', category: null });
    await repo.append('1', { id: 'b', name: 'B', stock: '2', category: null });
  });
  afterAll(async () => { await pool.end(); await closePool(); });
  it('同じIDで改名・並替・新規追加・削除を確定する', async () => {
    const before = await repo.fetchAll('1');
    await repo.apply('1', before, [{ ...before[0], name: '改名' }, { id: 'c', name: 'C', stock: '3.5', category: null }]);
    expect(await repo.fetchAll('1')).toMatchObject([{ id: 'a', name: '改名', stock: before[0].stock, category: null, position: 0 }, { id: 'c', name: 'C', position: 1 }]);
  });
  it('参照中の在庫削除に失敗したら変更・追加を全件rollbackする', async () => {
    await new PostgresRemindChannelRepository(pool).save({ channelId: '2', messageId: null, listTitle: 'R', operationLogThreadId: null, remindNoticeThreadId: null, remindNoticeMessageId: null, linkedInventoryChannelId: '1' });
    const now = new Date('2026-09-05T12:00:00Z');
    await new PostgresRemindTaskRepository(pool).appendTask('2', { id: 'task', messageId: null, title: 'T', description: null, intervalDays: 1, timeOfDay: '21:00', remindBeforeMinutes: 0, startAt: now, nextDueAt: now, lastDoneAt: null, lastRemindDueAt: null, overdueNotifyCount: 0, overdueNotifyLimit: null, lastOverdueNotifiedAt: null, isPaused: false, createdAt: now, updatedAt: now, inventoryItems: [{ inventoryId: 'b', consume: '1' }] });
    const before = await repo.fetchAll('1');
    await expect(repo.apply('1', before, [{ ...before[0], stock: '1' }, { id: 'c', name: 'C', stock: '1', category: null }])).rejects.toMatchObject({ code: 'referenced' });
    expect(await repo.fetchAll('1')).toEqual(before);
  });
  it('編集開始後の消費や変更を上書きせず競合拒否する', async () => {
    const before = await repo.fetchAll('1');
    await repo.update('1', { ...before[1], stock: '1' });
    await expect(repo.apply('1', before, [{ ...before[0], name: '改名' }, before[1]])).rejects.toMatchObject({ code: 'conflict' });
    expect((await repo.findById('1', 'a'))?.name).toBe('A');
    expect((await repo.findById('1', 'b'))?.stock).toBe('1');
  });
  it('2つの既存名を入れ替えてもIDを保持する', async () => {
    const before = await repo.fetchAll('1');
    await repo.apply('1', before, [{ ...before[0], name: 'B' }, { ...before[1], name: 'A' }]);
    expect((await repo.fetchAll('1')).map(x => [x.id, x.name])).toEqual([['a', 'B'], ['b', 'A']]);
  });
  it('ボタン→CSV改名→モーダル保存→Discord描画で精度とNULLを保つ', async () => {
    const adapter = new InventoryAdapter(repo);
    const logger = new Logger();
    const showModal = vi.fn();
    const channelStore = new InventoryChannelStore(new PostgresInventoryChannelRepository(pool));
    await new InventoryUpdateButtonHandler(logger, adapter, undefined, undefined, channelStore).handle({ interaction: { customId: 'inventory_update', channelId: '1', user: { id: '3' }, showModal } } as any);
    const modal = showModal.mock.calls[0][0].toJSON();
    expect(modal.components[0].components[0].value).toBe('1,A,9007199254740993.123456789,\n2,B,2,');
    const message = { id: '99', edit: vi.fn(), pin: vi.fn() };
    const send = vi.fn().mockResolvedValue(message);
    const client = { channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send, messages: { fetch: vi.fn().mockResolvedValue(message) } }) } };
    const reply = vi.fn();
    const handler = new InventoryUpdateModalHandler(logger, adapter, InventoryMessageManager.getInstance(), { refreshTasksUsingInventory: async (): Promise<void> => { } }, InventoryEditSession.shared);
    await handler.handle({ interaction: { customId: modal.custom_id, channelId: '1', user: { id: '3' }, client, fields: { getTextInputValue: (): string => '1,改名,9007199254740993.123456789,\n2,B,2,' }, deferReply: vi.fn(), editReply: reply } } as any);
    expect(reply).toHaveBeenCalledWith({ content: '✅ 在庫アイテムを更新しました。' });
    expect(await repo.findById('1', 'a')).toMatchObject({ name: '改名', stock: '9007199254740993.123456789', category: null });
    expect(JSON.stringify(send.mock.calls)).toContain('改名');
    expect(JSON.stringify(send.mock.calls)).not.toContain('スプレッドシート');
  });
});
