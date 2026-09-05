import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Client } from 'discord.js';
import { applyMigrations } from '../../src/db/schema';
import { PostgresInventoryRepository } from '../../src/repositories/PostgresInventoryRepository';
import { PostgresRemindTaskRepository } from '../../src/repositories/PostgresRemindTaskRepository';
import { PostgresInventoryChannelRepository } from '../../src/repositories/PostgresInventoryChannelRepository';
import { PostgresRemindChannelRepository } from '../../src/repositories/PostgresRemindChannelRepository';
import { InventoryRepository } from '../../src/services/InventoryRepository';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { RemindChannelStore } from '../../src/services/RemindChannelStore';
import { InventoryService } from '../../src/services/InventoryService';
import { RemindTaskService } from '../../src/services/RemindTaskService';
import { RemindMessageManager } from '../../src/services/RemindMessageManager';
import { RemindScheduler } from '../../src/services/RemindScheduler';
import { RemindTaskCompleteModalHandler } from '../../src/modals/RemindTaskCompleteModalHandler';
import { Logger } from '../../src/utils/logger';
import { testPool, resetDatabase } from './helpers';
class CompletionHandler extends RemindTaskCompleteModalHandler {
  execute = this.executeAction.bind(this);
}
describe('reminder Bot with real PostgreSQL and mocked Discord', () => {
  const pool = testPool();
  const stockDb = new PostgresInventoryRepository(pool);
  const taskDb = new PostgresRemindTaskRepository(pool);
  const stockChannels = new PostgresInventoryChannelRepository(pool);
  const taskChannels = new PostgresRemindChannelRepository(pool);
  const metadata = new RemindChannelStore(taskChannels);
  const stocks = new InventoryRepository(stockDb);
  const tasks = new RemindTaskRepository(taskDb);
  const inventory = new InventoryService(stocks, metadata, tasks);
  const now = new Date('2026-01-01T00:00:00Z');
  beforeAll(async () => { await resetDatabase(pool); await applyMigrations(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE inventory_channels,remind_channels CASCADE');
    await stockChannels.save({ channelId: '2', messageId: null, listTitle: '在庫', defaultCategory: 'その他', operationLogThreadId: null });
    await taskChannels.save({ channelId: '3', messageId: null, listTitle: '家事', operationLogThreadId: null, remindNoticeThreadId: '8', remindNoticeMessageId: '9', linkedInventoryChannelId: '2' });
    await stocks.append('2', { id: 'rice', name: '米', stock: '9007199254740993.123', category: '' });
    await stocks.append('2', { id: 'water', name: '水', stock: '0.1', category: '' });
  });
  afterAll(async () => { await pool.end(); });
  function discord(): {
        client: Client;
        messages: RemindMessageManager;
        service: RemindTaskService;
        send: ReturnType<typeof vi.fn>;
        edit: ReturnType<typeof vi.fn>;
        threadSend: ReturnType<typeof vi.fn>;
        } {
    const edit = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue({ id: '4' });
    const threadSend = vi.fn().mockResolvedValue(undefined);
    const channel = { isTextBased: (): boolean => true, send, messages: { fetch: vi.fn().mockResolvedValue({ id: '4', edit, components: [] }) } };
    const thread = { id: '8', isThread: (): boolean => true, send: threadSend };
    const client = { channels: { fetch: vi.fn(async (id: string) => id === '8' ? thread : channel) } } as unknown as Client;
    const messages = new RemindMessageManager({ inventoryService: inventory, metadataManager: metadata });
    const service = new RemindTaskService(tasks, metadata, messages, () => 'task');
    return { client, messages, service, send, edit, threadSend };
  }
  async function create(): Promise<ReturnType<typeof discord>> {
    const d = discord();
    const result = await d.service.addTask('3', { title: '料理', intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 60, inventoryItems: [{ inventoryId: 'rice', consume: '0' }, { inventoryId: 'water', consume: '1' }] }, d.client, now);
    expect(result.success).toBe(true);
    return d;
  }
  it('creates task, persists Discord message ID and edits only requested fields', async () => {
    const d = await create();
    const task = (await tasks.fetchTasks('3'))[0];
    expect(task).toMatchObject({ messageId: '4', revision: '1', title: '料理' });
    expect(d.send).toHaveBeenCalledOnce();
    await tasks.patchTask('3', task, { title: '炊飯' });
    const edited = (await tasks.fetchTasks('3'))[0];
    expect(edited).toMatchObject({ title: '炊飯', revision: '2', nextDueAt: task.nextDueAt, inventoryItems: task.inventoryItems });
    expect(edited.createdAt).toEqual(now);
    await expect(tasks.patchTask('3', task, { title: 'stale' })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('rolls back all stocks and completion state on shortage then applies temporary consume once', async () => {
    const d = await create();
    const task = (await tasks.fetchTasks('3'))[0];
    const handler = new CompletionHandler(new Logger(), undefined, metadata, tasks, d.messages, stocks, { createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true }) }, { refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined) });
    const context = { interaction: { channelId: '3', customId: `remind-task-complete-modal:4:${task.revision}`, client: d.client, fields: { getTextInputValue: () => '米,0.3' } } } as any;
    expect((await handler.execute(context)).success).toBe(false);
    expect((await stocks.findById('2', 'rice'))?.stock).toBe('9007199254740993.123');
    expect((await tasks.fetchTasks('3'))[0]).toMatchObject({ revision: '1', lastDoneAt: null });
    await stocks.update('2', { id: 'water', name: '水', stock: '2', category: '' });
    expect((await handler.execute(context)).success).toBe(true);
    expect((await stocks.findById('2', 'rice'))?.stock).toBe('9007199254740992.823');
    expect((await stocks.findById('2', 'water'))?.stock).toBe('1');
    const completed = (await tasks.fetchTasks('3'))[0];
    expect(completed.inventoryItems).toEqual(task.inventoryItems);
    expect(completed.lastDoneAt).toBeInstanceOf(Date);
    expect(completed.revision).toBe('2');
    expect((await handler.execute(context)).success).toBe(false);
    expect((await stocks.findById('2', 'water'))?.stock).toBe('1');
  });
  it('marks actual Discord notification and protects referenced inventory until task deletion', async () => {
    const d = await create();
    const task = (await tasks.fetchTasks('3'))[0];
    const notifyAt = new Date(task.nextDueAt.getTime() - 30 * 60000);
    const scheduler = new RemindScheduler(metadata, tasks, d.messages, inventory);
    await scheduler.runOnce(d.client, notifyAt);
    expect(d.threadSend).toHaveBeenCalledOnce();
    expect((await tasks.fetchTasks('3'))[0].lastRemindDueAt).toEqual(task.nextDueAt);
    await scheduler.runOnce(d.client, notifyAt);
    expect(d.threadSend).toHaveBeenCalledOnce();
    await expect(stocks.delete('2', 'rice')).rejects.toMatchObject({ code: 'referenced' });
    await expect(inventory.delete('2', 'rice')).rejects.toThrow('参照中');
    await tasks.deleteTask('3', 'task');
    expect((await stocks.findById('2', 'rice'))?.stock).toBe('9007199254740993.123');
    await inventory.delete('2', 'rice');
    expect(await stocks.findById('2', 'rice')).toBeNull();
  });
});
