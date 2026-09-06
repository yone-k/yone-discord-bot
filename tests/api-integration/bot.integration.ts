import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ChannelType, type Client, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { ApiListRepository, ApiListChannelRepository, ApiInventoryRepository, ApiInventoryChannelRepository, ApiRemindChannelRepository, ApiRemindTaskRepository } from '../../src/api/Repositories';
import { coreClient } from '../../src/api/CoreClient';
import type { Schema } from '../../src/api/contracts';
import { ListChannelStore } from '../../src/services/ListChannelStore';
import { MessageManager } from '../../src/services/MessageManager';
import { ListInitializationService } from '../../src/services/ListInitializationService';
import { RemindTaskService } from '../../src/services/RemindTaskService';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { RemindMessageManager } from '../../src/services/RemindMessageManager';
import { RemindTaskCompleteButtonHandler } from '../../src/buttons/RemindTaskCompleteButtonHandler';
import { NotificationScheduler } from '../../src/services/NotificationScheduler';
import { Logger } from '../../src/utils/logger';
import { InventoryService } from '../../src/services/InventoryService';

function fixture(sql: string): string {
  const raw = process.env.TEST_DATABASE_URL;
  const container = process.env.TEST_DB_CONTAINER_ID;
  if (!raw || !container || !process.env.API_INTEGRATION_CLUSTER_ID) throw new Error('Run through scripts/test-api-integration.mjs');
  const url = new URL(raw);
  if (!/^[a-z][a-z0-9_]*_http$/.test(url.pathname.slice(1))) throw new Error('Dedicated HTTP database required');
  const query = (text: string): string => execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD', container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', decodeURIComponent(url.username), '-d', url.pathname.slice(1)], { input: text, encoding: 'utf8', timeout: 10000, env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) } }).trim();
  if (query('SELECT system_identifier::text FROM pg_control_system()') !== process.env.API_INTEGRATION_CLUSTER_ID) throw new Error('Cluster changed');
  return query(sql);
}
function discord(channelId: string): { client: Client; channel: Record<string, unknown>; message: { id: string }; edit: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> } {
  const edit = vi.fn();
  const message = { id: `${channelId}99`, pinned: true, edit, pin: vi.fn(), startThread: vi.fn() };
  edit.mockResolvedValue(message);
  const send = vi.fn().mockResolvedValue(message);
  const channel = { id: channelId, name: '買物', type: ChannelType.GuildText, isTextBased: (): boolean => true, send, messages: { fetch: vi.fn().mockResolvedValue(message) } };
  const client = { channels: { fetch: vi.fn().mockResolvedValue(channel) } } as unknown as Client;
  return { client, channel, message, edit, send };
}

describe('Discord adapters → real Go API → PostgreSQL 18', () => {
  beforeAll(async () => { fixture('SELECT 1'); await coreClient().assertReady(); });
  it('skips only duplicate inventory names using the authoritative API error', async () => {
    const channels = new ApiInventoryChannelRepository();
    await channels.save({ channelId: '902', listTitle: '重複', defaultCategory: '食品', messageId: null, operationLogThreadId: null });
    const service = InventoryService.getInstance();
    expect((await service.create('902', { name: '米', stock: '1', category: '' })).success).toBe(true);
    expect(await service.create('902', { name: '米', stock: '2', category: '' })).toEqual({ success: false, message: '同名のアイテムが既に存在します' });
    expect((await service.create('902', { name: 'パン', stock: '3', category: '' })).success).toBe(true);
    expect(await new ApiInventoryRepository().fetchAll('902')).toMatchObject([{ name: '米', stock: '1' }, { name: 'パン', stock: '3' }]);
  });
  it('reads, updates and deletes opaque legacy IDs without URL normalization or escape collisions', async () => {
    const repository = new ApiInventoryRepository();
    fixture('INSERT INTO inventory_channels(channel_id,list_title,default_category) VALUES(\'901\',\'旧ID\',\'食品\')');
    const ids = ['.', '..', 'a/b', '%2E', '~Lg', '日本語'];
    for (const [position, id] of ids.entries()) {
      fixture(`INSERT INTO inventory_items(channel_id,id,name,stock,position) VALUES('901','${id}','item${position}',1,${position})`);
      expect(await repository.findById('901', id)).toMatchObject({ id, stock: '1' });
      await repository.update('901', { id, name: `item${position}`, stock: '2.123', category: null });
      expect(await repository.findById('901', id)).toMatchObject({ id, stock: '2.123' });
      await repository.delete('901', id);
      expect(await repository.findById('901', id)).toBeNull();
    }
  });
  it('initializes and redraws the real list with persisted message ID and edit conflict', async () => {
    const mock = discord('101');
    const repository = new ApiListRepository();
    const channels = new ApiListChannelRepository();
    const metadata = new ListChannelStore(channels);
    const service = new ListInitializationService(repository, new MessageManager(metadata), metadata);
    const interaction = { channel: mock.channel, client: mock.client } as unknown as ChatInputCommandInteraction;
    await service.initializeList({ channelId: '101', interaction }, false, '食品');
    expect(await channels.get('101')).toMatchObject({ messageId: '10199', defaultCategory: '食品' });
    const stale = await repository.snapshot('101');
    await repository.append('101', { name: '牛乳', category: null, until: null, isCompleted: false });
    await expect(repository.save('101', stale.editVersion, [])).rejects.toMatchObject({ code: 'conflict', status: 409 });
    await service.initializeList({ channelId: '101', interaction }, null, '食品', true);
    expect(JSON.stringify(mock.edit.mock.calls)).toContain('牛乳');
    expect((await repository.fetchAll('101'))[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it('creates one Discord card and returns the task with its persisted message ID and revision', async () => {
    const mock = discord('202');
    const service = new RemindTaskService();
    const result = await service.addTask('202', { title: 'フィルター交換', intervalDays: 7, timeOfDay: '09:00' }, mock.client);
    expect(result.success).toBe(true);
    expect(result.task).toMatchObject({ messageId: '20299', revision: '1' });
    expect(result.task!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(fixture('SELECT bool_and(entity_id::text=id) FROM remind_tasks WHERE channel_id=\'202\'')).toBe('t');
    const stored = await new RemindTaskRepository().findTaskByMessageId('202', '20299');
    expect(stored?.id).toBe(result.task?.id);
    expect(JSON.stringify(mock.send.mock.calls)).toContain('remind-task-complete');
    expect(mock.edit).not.toHaveBeenCalled();
    expect(JSON.stringify(mock.send.mock.calls)).toContain('フィルター交換');
    await new ApiRemindTaskRepository().deleteTask('202', result.task!.id);
  });

  it('uses the old customId and message ID to complete a legacy task with exact inventory decrement', async () => {
    fixture(`INSERT INTO inventory_channels(channel_id,list_title,default_category) VALUES('303','在庫','食品');
      INSERT INTO remind_channels(channel_id,list_title,linked_inventory_channel_id) VALUES('304','作業','303');
      INSERT INTO inventory_items(channel_id,id,name,stock,position) VALUES('303','legacy-stock','洗剤',9007199254740993.0000000000000000003,0);
      INSERT INTO remind_tasks(channel_id,id,message_id,title,interval_days,time_of_day,remind_before_minutes,start_at,next_due_at,created_at,updated_at,position)
        VALUES('304','legacy-task','30499','掃除',1,'09:00',60,now(),now()+interval '1 day',now(),now(),0);
      INSERT INTO remind_task_inventory_items(task_channel_id,task_id,inventory_channel_id,inventory_id,consume,position) VALUES('304','legacy-task','303','legacy-stock',0.0000000000000000002,0);`);
    const mock = discord('304');
    const interaction = { customId: 'remind-task-complete', channelId: '304', message: mock.message, client: mock.client,
      user: { id: '42' }, deferred: false, replied: false, deferReply: vi.fn(), deleteReply: vi.fn(), editReply: vi.fn(), reply: vi.fn() } as unknown as ButtonInteraction;
    const handler = new RemindTaskCompleteButtonHandler(new Logger(), undefined, undefined, new RemindTaskRepository(), new RemindMessageManager());
    await handler.handle({ interaction });
    const stock = await new ApiInventoryRepository().findById('303', 'legacy-stock');
    expect(stock?.stock).toBe('9007199254740993.0000000000000000001');
    const task = await new RemindTaskRepository().findTaskByMessageId('304', '30499');
    expect(task?.revision).toBe('1');
    expect(task?.lastDoneAt).toBeInstanceOf(Date);
    expect(JSON.stringify(mock.edit.mock.calls)).toContain('掃除');
  });

  it('keeps data unchanged when completion inventory is insufficient', async () => {
    const inventory = new ApiInventoryRepository(); const channels = new ApiInventoryChannelRepository(); const reminders = new ApiRemindChannelRepository(); const tasks = new ApiRemindTaskRepository();
    await channels.save({ channelId: '405', listTitle: '在庫', defaultCategory: '食品', messageId: null, operationLogThreadId: null });
    const item = await inventory.resolveByName('405', '不足品');
    await reminders.save({ channelId: '406', listTitle: '作業', messageId: null, operationLogThreadId: null, remindNoticeThreadId: null, remindNoticeMessageId: null, linkedInventoryChannelId: null });
    await reminders.linkInventory('406', '405');
    const task = await tasks.appendTask('406', { title: '不足', description: null, intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 60, inventoryItems: [{ inventoryId: item.id, consume: '1' }] });
    await expect(tasks.complete('406', task.id, task.revision)).rejects.toMatchObject({ code: 'shortage', status: 409 });
    expect((await tasks.fetchTasks('406'))[0]).toEqual(task);
    expect((await inventory.findById('405', item.id))?.stock).toBe('0');
  });

  it('records real list delivery and leaves failed Discord sends unacknowledged', async () => {
    const list = new ApiListRepository(); const channels = new ApiListChannelRepository();
    await channels.save({ channelId: '507', listTitle: '期限', defaultCategory: '食品', messageId: null, operationLogThreadId: '508' });
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    const item = await list.append('507', { name: '期限品', category: null, until: date, isCompleted: false });
    const client = coreClient();
    const plan = await client.request<Schema['NotificationPlan']>('POST', '/v1/notifications/poll');
    const notification = plan.notifications.find(n => n.id === item.id)!;
    expect(notification.kind).toBe('list');
    const send = vi.fn().mockRejectedValueOnce(new Error('Discord unavailable')).mockResolvedValue({ id: 'notice' });
    const discordClient = { channels: { fetch: vi.fn().mockResolvedValue({ send }) } } as unknown as Client;
    const scheduler = new NotificationScheduler();
    await scheduler.runOnce(discordClient);
    expect((await list.fetchAll('507'))[0].lastNotifiedAt).toBeNull();
    await scheduler.runOnce(discordClient);
    expect((await list.fetchAll('507'))[0].lastNotifiedAt).toBeInstanceOf(Date);
    await scheduler.runOnce(discordClient);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('uses captured reminder revision for ack and rejects replay without double increment', async () => {
    const channels = new ApiRemindChannelRepository(); const tasks = new ApiRemindTaskRepository();
    await channels.save({ channelId: '609', listTitle: '通知', messageId: null, operationLogThreadId: null, remindNoticeThreadId: '610', remindNoticeMessageId: '611', linkedInventoryChannelId: null });
    let task = await tasks.appendTask('609', { title: '期限切れ', description: null, intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 0, inventoryItems: [] });
    task = await tasks.patchTask('609', task.id, task.revision, { messageId: '612', nextDueAt: new Date(Date.now() - 60000).toISOString() });
    const api = coreClient();
    const plan = await api.request<Schema['NotificationPlan']>('POST', '/v1/notifications/poll');
    const notification = plan.notifications.find(n => n.id === task.id)!;
    const { kind, channelId, id, targetDueAt, expectedRevision, evaluatedAt } = notification;
    const token = { kind, channelId, id, targetDueAt, expectedRevision, evaluatedAt };
    await expect(api.request('POST', '/v1/notifications/ack', { ...token, expectedRevision: '0' })).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect((await tasks.fetchTasks('609'))[0].overdueNotifyCount).toBe(0);
    const acknowledged = await api.request<Schema['NotificationAckResult']>('POST', '/v1/notifications/ack', token);
    expect(acknowledged.task?.overdueNotifyCount).toBe(1);
    await expect(api.request('POST', '/v1/notifications/ack', token)).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect((await tasks.fetchTasks('609'))[0].overdueNotifyCount).toBe(1);
  });

  it('does not record a stale deadline when data changes after Discord send', async () => {
    const list = new ApiListRepository(); const channels = new ApiListChannelRepository();
    await channels.save({ channelId: '707', listTitle: '競合', defaultCategory: '食品', messageId: null, operationLogThreadId: '708' });
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    const item = await list.append('707', { name: '移動する期限', category: null, until: today, isCompleted: false });
    const send = vi.fn().mockImplementation(async (): Promise<{ id: string }> => {
      await list.update('707', item.id, { name: item.name, category: null, until: null, isCompleted: false });
      return { id: 'sent-before-conflict' };
    });
    const client = { channels: { fetch: vi.fn().mockResolvedValue({ send }) } } as unknown as Client;
    const scheduler = new NotificationScheduler();
    await scheduler.runOnce(client);
    expect((await list.fetchAll('707'))[0]).toMatchObject({ until: null, lastNotifiedAt: null });
    await scheduler.runOnce(client);
    expect(send).toHaveBeenCalledOnce();
  });
});
