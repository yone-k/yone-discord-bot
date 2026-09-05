import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../../src/db/schema';
import { PostgresListRepository } from '../../src/repositories/PostgresListRepository';
import { PostgresInventoryRepository } from '../../src/repositories/PostgresInventoryRepository';
import { PostgresRemindTaskRepository } from '../../src/repositories/PostgresRemindTaskRepository';
import { PostgresListChannelRepository } from '../../src/repositories/PostgresListChannelRepository';
import { PostgresInventoryChannelRepository } from '../../src/repositories/PostgresInventoryChannelRepository';
import { PostgresRemindChannelRepository } from '../../src/repositories/PostgresRemindChannelRepository';
import type { NewRemindTask } from '../../src/repositories/contracts';
import { resetDatabase, testPool } from './helpers';

describe('PostgreSQL domain repositories', () => {
  const pool = testPool();
  const lists = new PostgresListRepository(pool);
  const stocks = new PostgresInventoryRepository(pool);
  const tasks = new PostgresRemindTaskRepository(pool);
  const listChannels = new PostgresListChannelRepository(pool);
  const inventoryChannels = new PostgresInventoryChannelRepository(pool);
  const remindChannels = new PostgresRemindChannelRepository(pool);
  const now = new Date('2026-09-05T12:00:00.000Z');
  const task = (id = 'task'): NewRemindTask => ({ id, messageId: null, title: 'Task', description: null,
    intervalDays: 1, timeOfDay: '21:00', remindBeforeMinutes: 60, startAt: now, nextDueAt: now,
    lastDoneAt: null, lastRemindDueAt: null, overdueNotifyCount: 0, overdueNotifyLimit: null,
    lastOverdueNotifiedAt: null, isPaused: false, createdAt: now, updatedAt: now, inventoryItems: [] });
  beforeAll(async () => { await resetDatabase(pool); await applyMigrations(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE list_channels,inventory_channels,remind_channels CASCADE');
    await listChannels.save({channelId: '1', messageId: null, listTitle: 'List', defaultCategory: 'Other', operationLogThreadId: '9'});
    await inventoryChannels.save({channelId: '2', messageId: null, listTitle: 'Stock', defaultCategory: 'Other', operationLogThreadId: null});
    await remindChannels.save({channelId: '3', messageId: null, listTitle: 'Tasks', operationLogThreadId: null,
      remindNoticeThreadId: null, remindNoticeMessageId: null, linkedInventoryChannelId: '2'});
  });
  afterAll(async () => { await pool.end(); });

  it('retains UUID and latest notification during same-version CSV replacement', async () => {
    const item = await lists.append('1', {name: 'A', category: null, until: '2026-09-05', isCompleted: false});
    const snapshot = await lists.snapshot('1');
    await lists.markNotified(item.id, '2026-09-05', now);
    await lists.save('1', snapshot.editVersion, [{name: 'A', category: 'Category', until: '2026-09-05', isCompleted: true}]);
    expect(await lists.fetchAll('1')).toMatchObject([{id: item.id, lastNotifiedAt: now, isCompleted: true}]);
  });
  it('rejects a stale CSV save entirely after a concurrent business change', async () => {
    const snapshot = await lists.snapshot('1');
    await lists.append('1', {name: 'A', category: null, until: null, isCompleted: false});
    await expect(lists.save('1', snapshot.editVersion, [])).rejects.toMatchObject({code: 'conflict'});
    expect(await lists.fetchAll('1')).toHaveLength(1);
  });
  it('replaces renamed list items with fresh UUIDs and ignores old notifications', async () => {
    const old = await lists.append('1', {name: 'A', category: null, until: '2026-09-05', isCompleted: false});
    const snapshot = await lists.snapshot('1');
    await lists.save('1', snapshot.editVersion, [{name:'B', category:null, until:'2026-09-05', isCompleted:false}]);
    expect((await lists.fetchAll('1'))[0].id).not.toBe(old.id);
    expect(await lists.markNotified(old.id, '2026-09-05', now)).toBe(false);
  });
  it('preserves arbitrary decimal precision and rejects negative and nonfinite inventory', async () => {
    await stocks.append('2', {id:'a', name:'A', stock:'9007199254740993.123456789', category:null});
    expect((await stocks.findById('2','a'))?.stock).toBe('9007199254740993.123456789');
    for (const stock of ['-1','NaN','Infinity']) await expect(stocks.update('2',{id:'a',name:'A',stock,category:null})).rejects.toThrow();
  });
  it('rolls back every stock and task change when any stock is insufficient', async () => {
    await stocks.append('2', {id:'a',name:'A',stock:'10.1',category:null});
    await stocks.append('2', {id:'b',name:'B',stock:'0.1',category:null});
    await tasks.appendTask('3', {...task(), inventoryItems:[{inventoryId:'a',consume:'1.1'},{inventoryId:'b',consume:'1'}]});
    await expect(tasks.complete('3','task','0',now,new Date('2026-09-06T12:00Z'))).rejects.toMatchObject({code:'shortage'});
    expect((await stocks.fetchAll('2')).map(i => i.stock)).toEqual(['10.1','0.1']);
    expect((await tasks.fetchTasks('3'))[0].revision).toBe('0');
  });
  it('atomically consumes exact numeric values and keeps one-time overrides out of settings', async () => {
    await stocks.append('2', {id:'a',name:'A',stock:'9007199254740993.123456789',category:null});
    await tasks.appendTask('3',{...task(),inventoryItems:[{inventoryId:'a',consume:'0'}]});
    await tasks.complete('3','task','0',now,new Date('2026-09-06T12:00Z'),[{inventoryId:'a',consume:'0.000000001'}]);
    expect((await stocks.findById('2','a'))?.stock).toBe('9007199254740993.123456788');
    expect((await tasks.fetchTasks('3'))[0]).toMatchObject({revision:'1',lastDoneAt:now,inventoryItems:[{inventoryId:'a',consume:'0'}]});
  });
  it('rejects stale notification after completion and stale completion without consuming stock', async () => {
    await tasks.appendTask('3',task());
    const original = (await tasks.fetchTasks('3'))[0];
    await tasks.complete('3','task','0',now,new Date('2026-09-06T12:00Z'));
    expect(await tasks.markNotified(original,'before',now)).toBe(false);
    await expect(tasks.complete('3','task','0',now,now)).rejects.toMatchObject({code:'conflict'});
  });
  it('retains inventory on task deletion and rejects inventory deletion with task references', async () => {
    await stocks.append('2',{id:'a',name:'A',stock:'2',category:null});
    await tasks.appendTask('3',{...task(),inventoryItems:[{inventoryId:'a',consume:'1'}]});
    await expect(stocks.delete('2','a')).rejects.toMatchObject({code:'referenced'});
    expect(await tasks.referencingInventory('2','a')).toHaveLength(1);
    await tasks.deleteTask('3','task');
    expect(await stocks.findById('2','a')).not.toBeNull();
    expect((await pool.query('SELECT * FROM remind_task_inventory_items')).rowCount).toBe(0);
  });
  it('cascades valid link changes but rolls back missing targets and refuses unlink while referenced', async () => {
    await stocks.append('2',{id:'a',name:'A',stock:'2',category:null});
    await tasks.appendTask('3',{...task(),inventoryItems:[{inventoryId:'a',consume:'1'}]});
    await inventoryChannels.save({channelId:'4',messageId:null,listTitle:'Other',defaultCategory:'Other',operationLogThreadId:null});
    const channel = (await remindChannels.get('3'))!;
    await expect(remindChannels.save({...channel,linkedInventoryChannelId:'4'})).rejects.toThrow();
    await expect(remindChannels.save({...channel,linkedInventoryChannelId:null})).rejects.toThrow();
    expect((await remindChannels.get('3'))?.linkedInventoryChannelId).toBe('2');
    await stocks.append('4',{id:'a',name:'New A',stock:'1',category:null});
    await remindChannels.save({...channel,linkedInventoryChannelId:'4'});
    expect((await pool.query('SELECT inventory_channel_id FROM remind_task_inventory_items')).rows[0].inventory_channel_id).toBe('4');
  });

  it('swaps positions atomically for inventory and reminder rows', async () => {
    await stocks.append('2',{id:'a',name:'A',stock:'2',category:null});
    await stocks.append('2',{id:'b',name:'B',stock:'2',category:null});
    await stocks.reorder('2',['b','a']);
    expect((await stocks.fetchAll('2')).map(item => item.id)).toEqual(['b','a']);
    await tasks.appendTask('3',task('a'));
    await tasks.appendTask('3',task('b'));
    await tasks.reorder('3',['b','a']);
    expect((await tasks.fetchTasks('3')).map(item => item.id)).toEqual(['b','a']);
    expect((await tasks.fetchTasks('3'))[0].updatedAt).not.toEqual(now);
  });

  it('serializes independent CSV saves so exactly one equal-version writer commits', async () => {
    const snapshot = await lists.snapshot('1');
    const outcomes = await Promise.allSettled([
      lists.save('1',snapshot.editVersion,[{name:'A',category:null,until:null,isCompleted:false}]),
      lists.save('1',snapshot.editVersion,[{name:'B',category:null,until:null,isCompleted:false}]),
    ]);
    expect(outcomes.map(result => result.status).sort()).toEqual(['fulfilled','rejected']);
    expect(await lists.fetchAll('1')).toHaveLength(1);
  });

  it('serializes completion and notification without overwriting the completed deadline', async () => {
    await tasks.appendTask('3',task());
    const candidate = (await tasks.fetchTasks('3'))[0];
    const next = new Date('2026-09-06T12:00Z');
    const result = await Promise.allSettled([tasks.complete('3','task','0',now,next),tasks.markNotified(candidate,'before',now)]);
    const current = (await tasks.fetchTasks('3'))[0];
    if (result[0].status === 'fulfilled') expect(current).toMatchObject({nextDueAt:next,lastRemindDueAt:null});
    else expect(result[0].reason).toMatchObject({code:'conflict'});
    expect(current.revision).toBe('1');
  });

  it('does not increment list edit version for message redraw and preserves unrelated channel settings', async () => {
    const before = (await listChannels.get('1'))!;
    await Promise.all([listChannels.patch('1',{listTitle:'New'}),listChannels.patch('1',{messageId:'88'})]);
    expect(await listChannels.get('1')).toMatchObject({listTitle:'New',messageId:'88',editVersion:String(BigInt(before.editVersion)+1n)});
  });

  it('rejects duplicate CSV names without losing existing items', async () => {
    const item = {name:'A',category:null,until:null,isCompleted:false};
    await lists.append('1',item);
    const snapshot = await lists.snapshot('1');
    await expect(lists.save('1',snapshot.editVersion,[item,item])).rejects.toMatchObject({code:'invalid_input'});
    expect(await lists.fetchAll('1')).toHaveLength(1);
  });

  it('selects notification boundaries without treating NULL and zero limits as equal', async () => {
    const day = {date:'2026-09-05',start:new Date('2026-09-04T15:00Z'),end:new Date('2026-09-05T15:00Z')};
    await tasks.appendTask('3',{...task('exact'),messageId:'10'});
    await tasks.appendTask('3',{...task('overdue'),messageId:'11',nextDueAt:new Date(now.getTime()-1)});
    await tasks.appendTask('3',{...task('limited'),messageId:'12',nextDueAt:new Date(now.getTime()-1),overdueNotifyLimit:0});
    await tasks.appendTask('3',{...task('paused'),messageId:'13',isPaused:true});
    await tasks.appendTask('3',{...task('early'),messageId:'14',nextDueAt:new Date(now.getTime()+3600001)});
    expect((await tasks.notificationCandidates('3',now,day)).map(t => t.id)).toEqual(['exact','overdue']);
    const list = await lists.append('1',{name:'Today',category:null,until:day.date,isCompleted:false});
    await lists.markNotified(list.id,day.date,day.start);
    expect(await lists.notificationCandidates(day)).toHaveLength(0);
    await lists.markNotified(list.id,day.date,day.end);
    expect(await lists.notificationCandidates(day)).toHaveLength(1);
  });

  it('keeps multiple NULL message IDs but rejects duplicate non-NULL IDs and invalid periods', async () => {
    await tasks.appendTask('3',task('a'));
    await tasks.appendTask('3',task('b'));
    await tasks.appendTask('3',{...task('c'),messageId:'55'});
    await expect(tasks.appendTask('3',{...task('d'),messageId:'55'})).rejects.toThrow();
    for (const change of [{intervalDays:1.5},{remindBeforeMinutes:0.5},{intervalDays:0},{remindBeforeMinutes:10081},{timeOfDay:'24:00'}]) {
      await expect(tasks.appendTask('3',{...task('invalid'),...change})).rejects.toMatchObject({code:'invalid_input'});
    }
    expect(await tasks.fetchTasks('3')).toHaveLength(3);
  });

  it('replaces ordered consumption settings atomically and keeps tasks when a reference is removed', async () => {
    await stocks.append('2',{id:'a',name:'A',stock:'2',category:null});
    await stocks.append('2',{id:'b',name:'B',stock:'2',category:null});
    await tasks.appendTask('3',{...task(),inventoryItems:[{inventoryId:'a',consume:'1'},{inventoryId:'b',consume:'2'}]});
    let current = (await tasks.fetchTasks('3'))[0];
    await tasks.patchTask('3',current.id,current.revision,{inventoryItems:[{inventoryId:'b',consume:'2'},{inventoryId:'a',consume:'1'}]});
    current = (await tasks.fetchTasks('3'))[0];
    expect(current.inventoryItems.map(item => item.inventoryId)).toEqual(['b','a']);
    await expect(tasks.patchTask('3',current.id,current.revision,{inventoryItems:[{inventoryId:'missing',consume:'1'}]})).rejects.toMatchObject({code:'not_found'});
    expect((await tasks.fetchTasks('3'))[0].inventoryItems).toEqual(current.inventoryItems);
    await tasks.patchTask('3',current.id,current.revision,{inventoryItems:[{inventoryId:'b',consume:'2'}]});
    await stocks.delete('2','a');
    expect(await tasks.fetchTasks('3')).toHaveLength(1);
  });

  it('enforces numeric and reference constraints even when the Repository is bypassed', async () => {
    for (const stock of ['-1','NaN','Infinity','-Infinity']) {
      await expect(pool.query('INSERT INTO inventory_items(channel_id,id,name,stock,position) VALUES(\'2\',\'bad\',\'Bad\',$1,0)',[stock])).rejects.toThrow();
    }
    await stocks.append('2',{id:'a',name:'A',stock:'2',category:null});
    await tasks.appendTask('3',task());
    for (const consume of ['-1','NaN','Infinity','-Infinity']) {
      await expect(pool.query('INSERT INTO remind_task_inventory_items VALUES(\'3\',\'task\',\'2\',\'a\',$1,0)',[consume])).rejects.toThrow();
    }
    await pool.query('INSERT INTO remind_task_inventory_items VALUES(\'3\',\'task\',\'2\',\'a\',1,0)');
    await expect(pool.query('INSERT INTO remind_task_inventory_items VALUES(\'3\',\'task\',\'2\',\'a\',1,1)')).rejects.toThrow();
    await expect(pool.query('INSERT INTO remind_task_inventory_items VALUES(\'3\',\'task\',\'2\',\'missing\',1,1)')).rejects.toThrow();
  });

  it('rejects deleting channels with business data or inventory links', async () => {
    await lists.append('1',{name:'A',category:null,until:null,isCompleted:false});
    await expect(listChannels.delete('1')).rejects.toThrow();
    await expect(inventoryChannels.delete('2')).rejects.toThrow();
    await tasks.appendTask('3',task());
    await expect(remindChannels.delete('3')).rejects.toThrow();
  });

  it('preserves the parent snapshot connection for only the short read transaction', async () => {
    await lists.snapshot('1');
    expect(pool.idleCount).toBe(pool.totalCount);
  });

  it('updates only the message column without touching task settings or inventory references', async () => {
    await stocks.append('2',{id:'a',name:'A',stock:'2',category:null});
    await tasks.appendTask('3',{...task(),inventoryItems:[{inventoryId:'a',consume:'1'}]});
    await pool.query(`CREATE FUNCTION reject_reference_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'References must remain untouched'; END $$;
      CREATE TRIGGER reject_reference_write BEFORE INSERT OR UPDATE OR DELETE ON remind_task_inventory_items FOR EACH ROW EXECUTE FUNCTION reject_reference_write()`);
    try {
      await tasks.patchTask('3','task','0',{messageId:'55'});
      expect((await tasks.fetchTasks('3'))[0]).toMatchObject({messageId:'55',revision:'1',title:'Task',nextDueAt:now,inventoryItems:[{inventoryId:'a',consume:'1'}]});
      await expect(tasks.patchTask('3','task','0',{title:'Stale'})).rejects.toMatchObject({code:'conflict'});
    } finally {
      await pool.query('DROP TRIGGER reject_reference_write ON remind_task_inventory_items; DROP FUNCTION reject_reference_write()');
    }
  });
});
