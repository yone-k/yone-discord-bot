import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations } from '../../src/db/schema';
import { PostgresRemindTaskRepository } from '../../src/repositories/PostgresRemindTaskRepository';
import { runMigration } from '../../src/migration/runner';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from '../migration/fixture';
import { resetDatabase, testPool } from './helpers';
import { RemindTaskInventoryModalHandler } from '../../src/modals/RemindTaskInventoryModalHandler';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { Logger } from '../../src/utils/logger';
import { RemindTaskCompleteModalHandler } from '../../src/modals/RemindTaskCompleteModalHandler';
import { InventoryRepository } from '../../src/services/InventoryRepository';
import { PostgresInventoryRepository } from '../../src/repositories/PostgresInventoryRepository';
import { quoteCsvCell } from '../../src/utils/Csv';

class InventoryHandler extends RemindTaskInventoryModalHandler { execute = this.executeAction.bind(this); }
class CompletionHandler extends RemindTaskCompleteModalHandler { execute = this.executeAction.bind(this); }

describe('atomic reminder inventory settings', () => {
  const pool = testPool();
  const repository = new PostgresRemindTaskRepository(pool);
  let directory: string;
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'reminder-inventory-')); });
  beforeEach(async () => {
    await resetDatabase(pool); await applyMigrations(pool);
    const input = fixture(); input.sheets[4].rows[1][2] = '1.234';
    input.sheets[5].rows[1][7] = '[{"inventoryId":"item-A","consume":0.0123}]';
    const snapshot = join(directory, 'snapshot.json');
    await writeFile(snapshot, JSON.stringify(input));
    await runMigration({ snapshot, databaseUrl: process.env.DATABASE_URL });
  });
  afterAll(async () => { await pool.end(); await rm(directory, { recursive: true }); });
  it('preserves unedited stock and fixed consume precision', async () => {
    const result = await repository.editInventorySettings('3', 'task-A', '0', [{ name: '牛乳', stock: '1.234', consume: '0.0123' }]);
    expect(result.task.inventoryItems).toEqual([{ inventoryId: 'item-A', consume: '0.0123' }]);
    expect(result.stockChanged).toBe(false);
    expect((await pool.query('SELECT stock FROM inventory_items')).rows[0].stock).toBe('1.234');
    expect(result.task.revision).toBe('1');
  });
  it.each([' milk ', 'a,b', 'a"b', 'a\nb', 'a;b'])('round-trips exact name %j through settings and completion', async name => {
    await pool.query('UPDATE remind_tasks SET message_id=\'456\' WHERE channel_id=\'3\'');
    await pool.query('UPDATE inventory_items SET name=$1 WHERE id=$2', [name, 'item-A']);
    const updateTaskMessage = vi.fn(async () => {
      expect((await repository.fetchTasks('3'))[0].revision).toBe('1');
      expect((await pool.query('SELECT stock FROM inventory_items')).rows[0].stock).toBe('1.234');
    });
    const handler = new InventoryHandler(new Logger(), undefined, undefined, new RemindTaskRepository(repository), { updateTaskMessage } as any,
      { fetchAll: vi.fn().mockResolvedValue([]) }, { createOrUpdateMessage: vi.fn() }, { refreshTasksUsingInventory: vi.fn() });
    const result = await handler.execute({ interaction: { channelId: '3', customId: 'remind-task-inventory-modal:456:0', client: {}, fields: { getTextInputValue: (): string => `${quoteCsvCell(name)},1.234,0.0123` } } } as any);
    expect(result.success).toBe(true);
    expect(updateTaskMessage).toHaveBeenCalledOnce();
    expect((await repository.fetchTasks('3'))[0].inventoryItems[0].consume).toBe('0.0123');
    const stocks = new InventoryRepository(new PostgresInventoryRepository(pool));
    const completion = new CompletionHandler(new Logger(), undefined, { getChannelMetadata: vi.fn().mockResolvedValue({ metadata: { linkedInventoryChannelId: '2' } }) } as any,
      new RemindTaskRepository(repository), { updateTaskMessage: vi.fn() } as any, stocks, { createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true }) }, { refreshTasksUsingInventory: vi.fn() });
    expect((await completion.execute({ interaction: { channelId: '3', customId: 'remind-task-complete-modal:456:1', client: {}, fields: { getTextInputValue: (): string => `${quoteCsvCell(name)},0.0123` } } } as any)).success).toBe(true);
    expect((await stocks.fetchAll('2')).map(item => ({ id: item.id, name: item.name, stock: item.stock }))).toEqual([{ id: 'item-A', name, stock: '1.2217' }]);
  });
  it('normalizes edited values but preserves unchanged stock independently', async () => {
    const result = await repository.editInventorySettings('3', 'task-A', '0', [{ name: '牛乳', stock: '1.234', consume: '0.26' }, { name: '新規', stock: '2.26', consume: '1.16' }]);
    expect(result.task.inventoryItems.map(item => item.consume)).toEqual(['0.3', '1.2']);
    expect((await pool.query('SELECT stock FROM inventory_items WHERE id=$1', ['item-A'])).rows[0].stock).toBe('1.234');
    expect((await pool.query('SELECT stock FROM inventory_items WHERE name=$1', ['新規'])).rows[0].stock).toBe('2.3');
  });
  it.each([['0.0123', '1.2217'], ['0', '1.234']])('completes with input %s and retains the stored setting', async (consume, remaining) => {
    await pool.query('UPDATE remind_tasks SET message_id=\'456\' WHERE channel_id=\'3\'');
    const stockRepository = new InventoryRepository(new PostgresInventoryRepository(pool));
    const handler = new CompletionHandler(new Logger(), undefined, { getChannelMetadata: vi.fn().mockResolvedValue({ metadata: { linkedInventoryChannelId: '2' } }) } as any,
      new RemindTaskRepository(repository), { updateTaskMessage: vi.fn() } as any, stockRepository, { createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true }) }, { refreshTasksUsingInventory: vi.fn() });
    const result = await handler.execute({ interaction: { channelId: '3', customId: 'remind-task-complete-modal:456:0', client: {}, fields: { getTextInputValue: (): string => `牛乳,${consume}` } } } as any);
    expect(result.success).toBe(true);
    expect((await stockRepository.fetchAll('2'))[0].stock).toBe(remaining);
    expect((await repository.fetchTasks('3'))[0].inventoryItems[0].consume).toBe('0.0123');
  });
  it('rejects stale revision before creating inventory or changing stock', async () => {
    const other = await pool.connect();
    try { await other.query('UPDATE remind_tasks SET revision=revision+1 WHERE channel_id=\'3\''); }
    finally { other.release(); }
    await expect(repository.editInventorySettings('3', 'task-A', '0', [{ name: '牛乳', stock: '99', consume: '1' }, { name: '新規', stock: '5', consume: '1' }])).rejects.toMatchObject({ code: 'conflict' });
    expect((await pool.query('SELECT name,stock FROM inventory_items')).rows).toEqual([{ name: '牛乳', stock: '1.234' }]);
  });
  it('rolls back earlier stock changes when a later row is rejected by the database', async () => {
    await pool.query('ALTER TABLE inventory_items ADD CONSTRAINT reject_bad_name CHECK(name <> \'拒否\')');
    await expect(repository.editInventorySettings('3', 'task-A', '0', [{ name: '牛乳', stock: '99', consume: '1' }, { name: '拒否', stock: '5', consume: '1' }])).rejects.toThrow();
    expect((await pool.query('SELECT name,stock FROM inventory_items')).rows).toEqual([{ name: '牛乳', stock: '1.234' }]);
    expect((await repository.fetchTasks('3'))[0]).toMatchObject({ revision: '0', inventoryItems: [{ inventoryId: 'item-A', consume: '0.0123' }] });
  });
});
