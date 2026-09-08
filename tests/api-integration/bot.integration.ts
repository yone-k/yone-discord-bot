import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ChannelType, type Client, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction } from 'discord.js';
import { ApiListRepository, ApiListChannelRepository, ApiInventoryRepository, ApiInventoryChannelRepository, ApiRemindChannelRepository, ApiRemindTaskRepository } from '../../src/api/Repositories';
import { coreClient, withOutputOperation } from '../../src/api/CoreClient';
import { ListChannelStore } from '../../src/services/ListChannelStore';
import { OutputApi } from '../../src/api/OutputApi';
import { ListInitializationService } from '../../src/services/ListInitializationService';
import { RemindTaskService } from '../../src/services/RemindTaskService';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { RemindTaskCompleteButtonHandler } from '../../src/buttons/RemindTaskCompleteButtonHandler';
import { Logger } from '../../src/utils/logger';
import { InventoryService } from '../../src/services/InventoryService';
import { UiOperationEvents } from '../../src/services/UiOperationEvents';
import { AddListModalHandler } from '../../src/modals/AddListModalHandler';
import { InventoryAddModalHandler } from '../../src/modals/InventoryAddModalHandler';
import { InventoryInitializationService } from '../../src/services/InventoryInitializationService';
import { InventoryChannelStore } from '../../src/services/InventoryChannelStore';

function asOperation<T>(operationKind: string, action: () => Promise<T>): Promise<T> {
  return withOutputOperation({ actorId: '900000', operationKind }, action);
}

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
  it('keeps added item details through the real modal, API and operation record, then deletes its reply', async () => {
    fixture('INSERT INTO list_channels(channel_id,list_title,default_category,operation_log_thread_id) VALUES(\'831\',\'買物\',\'食品\',\'832\'); INSERT INTO list_items(channel_id,id,name,position) VALUES(\'831\',\'01990000-0000-7000-8000-000000000831\',\'既存の品\',0)');
    const interaction = {
      id: '831001', customId: 'add-list-modal', channelId: '831', user: { id: '42' },
      fields: { getTextInputValue: (key: string): string => key === 'items' ? '牛乳,2026-09-09\nパン' : '食品' },
      deferReply: vi.fn(), editReply: vi.fn(), deleteReply: vi.fn()
    };
    await new AddListModalHandler(new Logger(), undefined, undefined, new UiOperationEvents(new Logger())).handle({ interaction: interaction as unknown as ModalSubmitInteraction });
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
    expect(fixture('SELECT count(*) FROM operation_records WHERE interaction_id=\'831001\' AND success')).toBe('1');
    const facts = JSON.parse(fixture('SELECT facts FROM operation_records WHERE interaction_id=\'831001\''));
    expect(facts.Added).toEqual([
      { Name: '牛乳', Category: '食品', Check: false, Until: expect.any(String) },
      { Name: 'パン', Category: '食品', Check: false, Until: null }
    ]);
    expect(new Date(facts.Added[0].Until).toISOString()).toBe('2026-09-08T15:00:00.000Z');
    expect(fixture('SELECT count(*) FROM output_tasks WHERE channel_id=\'831\' AND kind=\'operation_log\'')).toBe('1');
  });
  it('records one successful inventory modal outcome after skipping the first duplicate', async () => {
    fixture('INSERT INTO inventory_channels(channel_id,list_title,default_category,operation_log_thread_id) VALUES(\'822\',\'在庫\',\'食品\',\'823\'); INSERT INTO inventory_items(channel_id,id,name,stock,position) VALUES(\'822\',\'old\',\'既存\',9,0)');
    const interaction = { id: '822001', customId: 'inventory_add_modal', channelId: '822', user: { id: '42' },
      fields: { getTextInputValue: (key: string): string => key === 'items' ? '既存,1\n新規,0.0000000000000000003\n新規,4' : '' },
      deferReply: vi.fn(), editReply: vi.fn(), deleteReply: vi.fn() };
    await new InventoryAddModalHandler(new Logger()).handle({ interaction: interaction as unknown as ModalSubmitInteraction });
    expect(await new ApiInventoryRepository().fetchAll('822')).toMatchObject([{ name: '既存', stock: '9' }, { name: '新規', stock: '0.0000000000000000003', category: '食品' }]);
    expect(fixture('SELECT count(*) FROM operation_records WHERE interaction_id=\'822001\' AND success')).toBe('1');
    expect(fixture('SELECT count(*) FROM operation_records WHERE interaction_id=\'822001\' AND NOT success')).toBe('0');
    expect(fixture('SELECT count(*) FROM output_tasks WHERE channel_id=\'822\' AND kind=\'operation_log\'')).toBe('0');
    expect(fixture('SELECT count(*) FROM output_tasks WHERE channel_id=\'822\' AND kind=\'inventory_render\'')).toBe('1');
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it('initializes a new inventory channel through the real API', () => withOutputOperation({ actorId: '900000', operationKind: 'InitInventoryCommand' }, async () => {
    const service = new InventoryInitializationService(new InventoryChannelStore());
    expect(await service.initializeInventory({ channelId: '810', listTitle: '在庫' })).toEqual({ success: true });
    expect(await new ApiInventoryChannelRepository().get('810')).toMatchObject({ listTitle: '在庫', messageId: null });
    expect(fixture('SELECT count(*) FROM operation_records WHERE channel_id=\'810\' AND success')).toBe('1');
    expect(fixture('SELECT count(*) FROM output_tasks WHERE channel_id=\'810\' AND kind=\'inventory_render\' AND state=\'pending\'')).toBe('1');
  }));
  it('preserves existing Discord destinations when all three channel settings are saved', () => withOutputOperation({ actorId: '900000', operationKind: 'InitListCommand' }, async () => {
    fixture('INSERT INTO list_channels(channel_id,list_title,default_category,message_id,operation_log_thread_id) VALUES(\'811\',\'old\',\'食品\',\'812\',\'813\'); INSERT INTO inventory_channels(channel_id,list_title,default_category,message_id,operation_log_thread_id) VALUES(\'814\',\'old\',\'食品\',\'815\',\'816\'); INSERT INTO remind_channels(channel_id,list_title,message_id,operation_log_thread_id,remind_notice_message_id,remind_notice_thread_id) VALUES(\'817\',\'old\',\'818\',\'819\',\'820\',\'821\')');
    const lists = new ApiListChannelRepository();
    const inventories = new ApiInventoryChannelRepository();
    const reminders = new ApiRemindChannelRepository();
    await lists.save({ channelId: '811', listTitle: 'new', defaultCategory: '食品' });
    await asOperation('InitInventoryCommand', () => inventories.save({ channelId: '814', listTitle: 'new', defaultCategory: '食品' }));
    await asOperation('InitRemindListCommand', () => reminders.save({ channelId: '817', listTitle: 'new', linkedInventoryChannelId: null }));
    expect(await lists.get('811')).toMatchObject({ listTitle: 'new', messageId: '812', operationLogThreadId: '813' });
    expect(await inventories.get('814')).toMatchObject({ listTitle: 'new', messageId: '815', operationLogThreadId: '816' });
    expect(await reminders.get('817')).toMatchObject({ listTitle: 'new', messageId: '818', operationLogThreadId: '819', remindNoticeMessageId: '820', remindNoticeThreadId: '821' });
  }));
  it('records local validation failure once through the UI event API', async () => {
    fixture('INSERT INTO list_channels(channel_id,list_title,default_category,operation_log_thread_id) VALUES(\'808\',\'買物\',\'食品\',\'809\')');
    const logger = new Logger();
    const handler = new AddListModalHandler(logger, undefined, undefined, new UiOperationEvents(logger));
    const interaction = { id: '808001', customId: 'add-list-modal', channelId: '808', user: { id: '42' },
      fields: { getTextInputValue: (key: string): string => key === 'items' ? '牛乳,invalid-date' : '' },
      deferReply: vi.fn(), editReply: vi.fn() };
    await handler.handle({ interaction: interaction as unknown as ModalSubmitInteraction });
    await handler.handle({ interaction: interaction as unknown as ModalSubmitInteraction });
    expect(fixture('SELECT actor_id || \':\' || operation_kind || \':\' || success FROM operation_records WHERE interaction_id=\'808001\'')).toBe('42:AddListModalHandler:false');
    expect(fixture('SELECT count(*) FROM output_tasks WHERE channel_id=\'808\' AND kind=\'operation_log\'')).toBe('1');
    expect(fixture('SELECT count(*) FROM list_items WHERE channel_id=\'808\'')).toBe('0');
    expect(interaction.editReply).toHaveBeenCalled();
  });
  it('skips only duplicate inventory names using the authoritative API error', () => withOutputOperation({ actorId: '900000', operationKind: 'InventoryAddModalHandler' }, async () => {
    const channels = new ApiInventoryChannelRepository();
    await asOperation('InitInventoryCommand', () => channels.save({ channelId: '902', listTitle: '重複', defaultCategory: '食品' }));
    const service = InventoryService.getInstance();
    expect((await service.create('902', { name: '米', stock: '1', category: '' })).success).toBe(true);
    expect(await service.create('902', { name: '米', stock: '2', category: '' })).toEqual({ success: false, message: '同名のアイテムが既に存在します' });
    expect((await service.create('902', { name: 'パン', stock: '3', category: '' })).success).toBe(true);
    expect(await new ApiInventoryRepository().fetchAll('902')).toMatchObject([{ name: '米', stock: '1' }, { name: 'パン', stock: '3' }]);
  }));
  it('reads, updates and deletes opaque legacy IDs without URL normalization or escape collisions', () => withOutputOperation({ actorId: '900000', operationKind: 'InventoryUpdateModalHandler' }, async () => {
    const repository = new ApiInventoryRepository();
    fixture('INSERT INTO inventory_channels(channel_id,list_title,default_category) VALUES(\'901\',\'旧ID\',\'食品\')');
    const ids = ['.', '..', 'a/b', '%2E', '~Lg', '日本語'];
    for (const [position, id] of ids.entries()) {
      fixture(`INSERT INTO inventory_items(channel_id,id,name,stock,position) VALUES('901','${id}','item${position}',1,${position})`);
      expect(await repository.findById('901', id)).toMatchObject({ id, stock: '1' });
      await repository.update('901', { id, name: `item${position}`, stock: '2.123', category: null });
      expect(await repository.findById('901', id)).toMatchObject({ id, stock: '2.123' });
      await asOperation('InventoryDeleteModalHandler', () => repository.delete('901', id));
      expect(await repository.findById('901', id)).toBeNull();
    }
  }));
  it('reserves initialization and redraw of the real list while retaining edit conflicts', () => withOutputOperation({ actorId: '900000', operationKind: 'InitListCommand' }, async () => {
    const mock = discord('101');
    const repository = new ApiListRepository();
    const channels = new ApiListChannelRepository();
    const metadata = new ListChannelStore(channels);
    const service = new ListInitializationService(repository, new OutputApi(), metadata);
    const interaction = { channel: mock.channel, client: mock.client } as unknown as ChatInputCommandInteraction;
    await service.initializeList({ channelId: '101', interaction }, false, '食品');
    expect(await channels.get('101')).toMatchObject({ messageId: null, defaultCategory: '食品' });
    const stale = await repository.snapshot('101');
    await asOperation('AddListModalHandler', () => repository.append('101', { name: '牛乳', category: null, until: null, isCompleted: false }));
    await expect(asOperation('EditListModalHandler', () => repository.save('101', stale.editVersion, []))).rejects.toMatchObject({ code: 'conflict', status: 409 });
    await service.initializeList({ channelId: '101', interaction }, null, '食品', true);
    expect(mock.edit).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
    expect(fixture('SELECT count(*) FROM output_tasks WHERE channel_id=\'101\' AND kind=\'list_render\' AND state=\'pending\'')).toBe('1');
    expect((await repository.fetchAll('101'))[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  }));

  it('creates a task and reserves its card atomically without a TypeScript Discord send', () => withOutputOperation({ actorId: '900000', operationKind: 'AddRemindListCommand' }, async () => {
    const mock = discord('202');
    const service = new RemindTaskService();
    const result = await service.addTask('202', { title: 'フィルター交換', intervalDays: 7, timeOfDay: '09:00' });
    expect(result.success).toBe(true);
    expect(result.task).toMatchObject({ revision: '0' });
    expect(result.task?.messageId).toBeUndefined();
    expect(fixture('SELECT count(*) FROM operation_records WHERE channel_id=\'202\' AND success')).toBe('1');
    expect(result.task!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(fixture('SELECT bool_and(entity_id::text=id) FROM remind_tasks WHERE channel_id=\'202\'')).toBe('t');
    expect(fixture('SELECT count(*) FROM output_tasks WHERE channel_id=\'202\' AND kind=\'task_card\' AND state=\'pending\'')).toBe('1');
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.edit).not.toHaveBeenCalled();
    await asOperation('RemindTaskDeleteModalHandler', () => new ApiRemindTaskRepository().deleteTask('202', result.task!.id));
  }));

  it('uses the old customId and message ID to complete a legacy task with exact inventory decrement', () => withOutputOperation({ actorId: '900000', operationKind: 'InitListCommand' }, async () => {
    fixture(`INSERT INTO inventory_channels(channel_id,list_title,default_category) VALUES('303','在庫','食品');
      INSERT INTO remind_channels(channel_id,list_title,linked_inventory_channel_id) VALUES('304','作業','303');
      INSERT INTO inventory_items(channel_id,id,name,stock,position) VALUES('303','legacy-stock','洗剤',9007199254740993.0000000000000000003,0);
      INSERT INTO remind_tasks(channel_id,id,message_id,title,interval_days,time_of_day,remind_before_minutes,start_at,next_due_at,created_at,updated_at,position)
        VALUES('304','legacy-task','30499','掃除',1,'09:00',60,now(),now()+interval '1 day',now(),now(),0);
      INSERT INTO remind_task_inventory_items(task_channel_id,task_id,inventory_channel_id,inventory_id,consume,position) VALUES('304','legacy-task','303','legacy-stock',0.0000000000000000002,0);`);
    const mock = discord('304');
    const interaction = { customId: 'remind-task-complete', channelId: '304', message: mock.message, client: mock.client,
      user: { id: '42' }, deferred: false, replied: false, deferReply: vi.fn(), deleteReply: vi.fn(), editReply: vi.fn(), reply: vi.fn() } as unknown as ButtonInteraction;
    const handler = new RemindTaskCompleteButtonHandler(new Logger(), undefined, undefined, new RemindTaskRepository());
    await handler.handle({ interaction });
    const stock = await new ApiInventoryRepository().findById('303', 'legacy-stock');
    expect(stock?.stock).toBe('9007199254740993.0000000000000000001');
    const task = await new RemindTaskRepository().findTaskByMessageId('304', '30499');
    expect(task?.revision).toBe('1');
    expect(task?.lastDoneAt).toBeInstanceOf(Date);
    expect(mock.edit).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
    expect(fixture('SELECT count(*) FROM output_tasks WHERE channel_id=\'304\' AND kind=\'task_card\' AND state=\'pending\'')).toBe('1');
    expect(fixture('SELECT count(*) FROM output_tasks WHERE channel_id=\'303\' AND kind=\'inventory_render\' AND state=\'pending\'')).toBe('1');
  }));

  it('keeps data unchanged when completion inventory is insufficient', () => withOutputOperation({ actorId: '900000', operationKind: 'InitListCommand' }, async () => {
    const inventory = new ApiInventoryRepository(); const channels = new ApiInventoryChannelRepository(); const reminders = new ApiRemindChannelRepository(); const tasks = new ApiRemindTaskRepository();
    await asOperation('InitInventoryCommand', () => channels.save({ channelId: '405', listTitle: '在庫', defaultCategory: '食品' }));
    const item = await asOperation('InventoryAddModalHandler', () => inventory.resolveByName('405', '不足品'));
    await asOperation('InitRemindListCommand', () => reminders.save({ channelId: '406', listTitle: '作業', linkedInventoryChannelId: null }));
    await asOperation('LinkInventoryCommand', () => reminders.linkInventory('406', '405'));
    const task = await asOperation('AddRemindListCommand', () => tasks.appendTask('406', { title: '不足', description: null, intervalDays: 1, timeOfDay: '09:00', remindBeforeMinutes: 60, inventoryItems: [{ inventoryId: item.id, consume: '1' }] }));
    await expect(asOperation('RemindTaskCompleteModalHandler', () => tasks.complete('406', task.id, task.revision))).rejects.toMatchObject({ code: 'shortage', status: 409 });
    expect((await tasks.fetchTasks('406'))[0]).toEqual(task);
    expect((await inventory.findById('405', item.id))?.stock).toBe('0');
  }));

});
