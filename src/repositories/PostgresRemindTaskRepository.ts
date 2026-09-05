import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool';
import { transaction } from '../db/transaction';
import { RepositoryError, type DayBounds, type InventoryConsumption, type NewRemindTask, type RemindTaskPatch, type RemindTaskRepository, type StoredRemindTask } from './contracts';
import { camelRow, decimal, lockChannel, patchColumns, requireRow } from './sql';
import type { RemindInventoryEdit, RemindInventoryEditResult } from './contracts';
import { compareDecimal, formatDecimal } from '../utils/Decimal';

const taskColumns = ['message_id','title','description','interval_days','time_of_day','remind_before_minutes','start_at','next_due_at','last_done_at','last_remind_due_at','overdue_notify_count','overdue_notify_limit','last_overdue_notified_at','is_paused','created_at','updated_at'];
const patchColumnNames = {
  messageId:'message_id',title:'title',description:'description',intervalDays:'interval_days',timeOfDay:'time_of_day',
  remindBeforeMinutes:'remind_before_minutes',startAt:'start_at',nextDueAt:'next_due_at',lastDoneAt:'last_done_at',
  lastRemindDueAt:'last_remind_due_at',overdueNotifyCount:'overdue_notify_count',overdueNotifyLimit:'overdue_notify_limit',
  lastOverdueNotifiedAt:'last_overdue_notified_at',isPaused:'is_paused',
};
const taskSelect = `t.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('inventoryId',i.inventory_id,'consume',i.consume::text) ORDER BY i.position)
  FROM remind_task_inventory_items i WHERE i.task_channel_id=t.channel_id AND i.task_id=t.id),'[]'::jsonb) AS inventory_items`;
function values(task: NewRemindTask): unknown[] {
  return [task.messageId,task.title,task.description,task.intervalDays,task.timeOfDay,task.remindBeforeMinutes,task.startAt,task.nextDueAt,task.lastDoneAt,
    task.lastRemindDueAt,task.overdueNotifyCount,task.overdueNotifyLimit,task.lastOverdueNotifiedAt,task.isPaused,task.createdAt,task.updatedAt];
}
function validate(task: NewRemindTask): void {
  if (!Number.isInteger(task.intervalDays) || task.intervalDays < 1 || task.intervalDays > 2147483647 ||
      !Number.isInteger(task.remindBeforeMinutes) || task.remindBeforeMinutes < 0 || task.remindBeforeMinutes > 10080 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.timeOfDay)) throw new RepositoryError('invalid_input','Invalid reminder period');
  for (const date of [task.startAt,task.nextDueAt,task.lastDoneAt,task.lastRemindDueAt,task.lastOverdueNotifiedAt,task.createdAt,task.updatedAt]) {
    if (date !== null && (!(date instanceof Date) || !Number.isFinite(date.getTime()))) throw new RepositoryError('invalid_input','Invalid reminder date');
  }
  validateConsumption(task.inventoryItems);
}
function validateConsumption(items: InventoryConsumption[]): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.inventoryId.trim() || ids.has(item.inventoryId)) throw new RepositoryError('invalid_input','Duplicate or empty inventory reference');
    ids.add(item.inventoryId); decimal(item.consume);
  }
}
function mapTask(row: Record<string, unknown>): StoredRemindTask {
  const task = camelRow<StoredRemindTask>(row);
  task.timeOfDay = task.timeOfDay.slice(0,5);
  return task;
}
export class PostgresRemindTaskRepository implements RemindTaskRepository {
  constructor(private readonly pool: Pool = getPool()) {}
  private async select(where: string,params: unknown[]): Promise<StoredRemindTask[]> {
    return (await this.pool.query(`SELECT ${taskSelect} FROM remind_tasks t WHERE ${where} ORDER BY t.channel_id,t.position`,params)).rows.map(mapTask);
  }
  async fetchTasks(channelId: string): Promise<StoredRemindTask[]> { return this.select('t.channel_id=$1',[channelId]); }
  async findTaskByMessageId(channelId: string,messageId: string): Promise<StoredRemindTask | null> {
    return (await this.select('t.channel_id=$1 AND t.message_id=$2',[channelId,messageId]))[0] ?? null;
  }
  private async lockTask(client: PoolClient,channelId: string,id: string): Promise<Record<string, unknown>> {
    const {rows} = await client.query('SELECT * FROM remind_tasks WHERE channel_id=$1 AND id=$2 FOR UPDATE',[channelId,id]);
    if (!rows[0]) throw new RepositoryError('not_found','Task does not exist');
    return rows[0];
  }
  private async replaceConsumption(client: PoolClient,channelId: string,id: string,inventoryChannel: string | null,items: InventoryConsumption[]): Promise<void> {
    if (items.length) {
      if (inventoryChannel === null) throw new RepositoryError('invalid_input','Inventory channel is not linked');
      await lockChannel(client,'inventory_channels',inventoryChannel);
      const result = await client.query('SELECT id FROM inventory_items WHERE channel_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE',[inventoryChannel,items.map(item => item.inventoryId)]);
      if (result.rowCount !== items.length) throw new RepositoryError('not_found','Referenced inventory does not exist');
    }
    await client.query('DELETE FROM remind_task_inventory_items WHERE task_channel_id=$1 AND task_id=$2',[channelId,id]);
    for (const [position,item] of items.entries()) {
      await client.query('INSERT INTO remind_task_inventory_items(task_channel_id,task_id,inventory_channel_id,inventory_id,consume,position) VALUES($1,$2,$3,$4,$5,$6)',
        [channelId,id,inventoryChannel,item.inventoryId,item.consume,position]);
    }
  }
  async appendTask(channelId: string,task: NewRemindTask): Promise<void> {
    validate(task);
    await transaction(this.pool,async client => {
      const channel = await lockChannel(client,'remind_channels',channelId);
      await client.query(`INSERT INTO remind_tasks(channel_id,id,${taskColumns.join(',')},position)
        VALUES($1,$2,${taskColumns.map((_,i) => `$${i+3}`).join(',')},(SELECT COALESCE(MAX(position)+1,0) FROM remind_tasks WHERE channel_id=$1))`,[channelId,task.id,...values(task)]);
      await this.replaceConsumption(client,channelId,task.id,channel.linked_inventory_channel_id as string | null,task.inventoryItems);
    });
  }
  async patchTask(channelId: string,id: string,expectedRevision: string,patch: RemindTaskPatch): Promise<void> {
    const {inventoryItems,...changes} = patch;
    const [columns,parameters] = patchColumns(changes,patchColumnNames);
    if (!columns.length && inventoryItems === undefined) return;
    await transaction(this.pool,async client => {
      const channel = await lockChannel(client,'remind_channels',channelId);
      const current = await this.lockTask(client,channelId,id);
      if (current.revision !== expectedRevision) throw new RepositoryError('conflict','Task has changed; reload it');
      const definedChanges = Object.fromEntries(Object.entries(changes).filter(([,value]) => value !== undefined));
      validate({...mapTask({...current,inventory_items:[]}),...definedChanges,inventoryItems:inventoryItems ?? []});
      if (inventoryItems !== undefined) await this.replaceConsumption(client,channelId,id,channel.linked_inventory_channel_id as string | null,inventoryItems);
      const assignments = columns.map((name,i) => `${name}=$${i+3}`);
      assignments.push('revision=revision+1','updated_at=CURRENT_TIMESTAMP');
      await client.query(`UPDATE remind_tasks SET ${assignments.join(',')} WHERE channel_id=$1 AND id=$2`,[channelId,id,...parameters]);
    });
  }
  async editInventorySettings(channelId: string,id: string,expectedRevision: string,items: RemindInventoryEdit[]): Promise<RemindInventoryEditResult> {
    const names = new Set<string>();
    for (const item of items) {
      if (!item.name.trim() || names.has(item.name)) throw new RepositoryError('invalid_input','Duplicate or empty inventory name');
      names.add(item.name);
      decimal(item.consume);
      if (item.stock !== undefined) decimal(item.stock);
    }
    return transaction(this.pool,async client => {
      const channel = await lockChannel(client,'remind_channels',channelId);
      const task = await this.lockTask(client,channelId,id);
      if (task.revision !== expectedRevision) throw new RepositoryError('conflict','タスクが変更されました。開き直してください。');
      const inventoryChannelId = channel.linked_inventory_channel_id as string | null;
      const oldReferences = (await client.query<{ inventory_id: string; consume: string }>('SELECT inventory_id,consume FROM remind_task_inventory_items WHERE task_channel_id=$1 AND task_id=$2',[channelId,id])).rows;
      const consumption: InventoryConsumption[] = [];
      let stockChanged = false;
      if (items.length) {
        if (inventoryChannelId === null) throw new RepositoryError('invalid_input','在庫チャンネルが連携されていません');
        await lockChannel(client,'inventory_channels',inventoryChannelId);
        const existing = (await client.query<{ id: string; name: string; stock: string }>('SELECT id,name,stock FROM inventory_items WHERE channel_id=$1 AND name=ANY($2::text[]) ORDER BY id FOR UPDATE',[inventoryChannelId,items.map(item => item.name)])).rows;
        for (const item of items) {
          let inventory = existing.find(row => row.name === item.name);
          if (!inventory) {
            inventory = (await client.query<{ id: string; name: string; stock: string }>(`INSERT INTO inventory_items(channel_id,name,stock,category,position)
              VALUES($1,$2,$3,NULL,(SELECT COALESCE(max(position)+1,0) FROM inventory_items WHERE channel_id=$1)) RETURNING id,name,stock`,[inventoryChannelId,item.name,item.stock === undefined ? '0' : formatDecimal(item.stock)])).rows[0];
            stockChanged = true;
          } else if (item.stock !== undefined && compareDecimal(item.stock,inventory.stock) !== 0) {
            await client.query('UPDATE inventory_items SET stock=$3 WHERE channel_id=$1 AND id=$2',[inventoryChannelId,inventory.id,formatDecimal(item.stock)]);
            stockChanged = true;
          }
          const old = oldReferences.find(ref => ref.inventory_id === inventory.id);
          const consume = old && compareDecimal(item.consume,old.consume) === 0 ? old.consume : formatDecimal(item.consume);
          consumption.push({ inventoryId: inventory.id, consume });
        }
      }
      await this.replaceConsumption(client,channelId,id,inventoryChannelId,consumption);
      await client.query('UPDATE remind_tasks SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE channel_id=$1 AND id=$2',[channelId,id]);
      const stored = (await client.query(`SELECT ${taskSelect} FROM remind_tasks t WHERE t.channel_id=$1 AND t.id=$2`,[channelId,id])).rows[0];
      return { task: mapTask(stored), inventoryChannelId, stockChanged };
    });
  }
  async deleteTask(channelId: string,id: string): Promise<void> {
    await transaction(this.pool,async client => {
      await lockChannel(client,'remind_channels',channelId);
      await this.lockTask(client,channelId,id);
      requireRow((await client.query('DELETE FROM remind_tasks WHERE channel_id=$1 AND id=$2',[channelId,id])).rowCount);
    });
  }
  async referencingInventory(channelId: string,inventoryId: string): Promise<StoredRemindTask[]> {
    return (await this.pool.query(`SELECT ${taskSelect} FROM remind_task_inventory_items r
      JOIN remind_tasks t ON t.channel_id=r.task_channel_id AND t.id=r.task_id
      WHERE r.inventory_channel_id=$1 AND r.inventory_id=$2 ORDER BY t.channel_id,t.position`,[channelId,inventoryId])).rows.map(mapTask);
  }
  async reorder(channelId: string,ids: string[]): Promise<void> {
    await transaction(this.pool,async client => {
      await lockChannel(client,'remind_channels',channelId);
      const rows = (await client.query('SELECT id FROM remind_tasks WHERE channel_id=$1 ORDER BY id FOR UPDATE',[channelId])).rows;
      if (new Set(ids).size !== ids.length || rows.length !== ids.length || rows.some(row => !ids.includes(row.id))) throw new RepositoryError('invalid_input','Reordering requires every task exactly once');
      for (const [position,id] of ids.entries()) await client.query('UPDATE remind_tasks SET position=$3,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE channel_id=$1 AND id=$2',[channelId,id,position]);
    });
  }
  async activeTasks(channelId: string): Promise<StoredRemindTask[]> { return this.select('t.channel_id=$1 AND NOT t.is_paused AND t.message_id IS NOT NULL',[channelId]); }
  async notificationCandidates(channelId: string,now: Date,day: DayBounds): Promise<StoredRemindTask[]> {
    return this.select(`t.channel_id=$1 AND NOT t.is_paused AND t.message_id IS NOT NULL AND t.next_due_at<=$2::timestamptz+interval '7 days' AND (
      (t.next_due_at-t.remind_before_minutes*interval '1 minute'<=$2 AND $2<=t.next_due_at AND t.last_remind_due_at IS DISTINCT FROM t.next_due_at) OR
      (t.next_due_at<$2 AND (t.overdue_notify_limit IS NULL OR t.overdue_notify_count<t.overdue_notify_limit)
      AND (t.last_overdue_notified_at IS NULL OR t.last_overdue_notified_at<$3 OR t.last_overdue_notified_at>=$4)))`,[channelId,now,day.start,day.end]);
  }
  async markNotified(task: StoredRemindTask,kind: 'before'|'overdue',now: Date): Promise<boolean> {
    return transaction(this.pool,async client => {
      await lockChannel(client,'remind_channels',task.channelId);
      const set = kind === 'before' ? 'last_remind_due_at=next_due_at' : 'last_overdue_notified_at=$5,overdue_notify_count=overdue_notify_count+1';
      return (await client.query(`UPDATE remind_tasks SET ${set},updated_at=$5,revision=revision+1
        WHERE channel_id=$1 AND id=$2 AND revision=$3 AND next_due_at=$4`,[task.channelId,task.id,task.revision,task.nextDueAt,now])).rowCount === 1;
    });
  }
  async complete(channelId: string,id: string,revision: string,completedAt: Date,nextDueAt: Date,consumption: InventoryConsumption[] = []): Promise<void> {
    if (![completedAt,nextDueAt].every(date => date instanceof Date && Number.isFinite(date.getTime()))) throw new RepositoryError('invalid_input','Invalid completion date');
    validateConsumption(consumption);
    await transaction(this.pool,async client => {
      const channel = await lockChannel(client,'remind_channels',channelId);
      const task = await this.lockTask(client,channelId,id);
      if (task.revision !== revision) throw new RepositoryError('conflict','Task has changed; reload it');
      const references = (await client.query<{inventory_id:string;consume:string}>('SELECT inventory_id,consume FROM remind_task_inventory_items WHERE task_channel_id=$1 AND task_id=$2 ORDER BY inventory_id',[channelId,id])).rows;
      const overrides = new Map(consumption.map(item => [item.inventoryId,item.consume]));
      if (consumption.some(item => !references.some(ref => ref.inventory_id === item.inventoryId))) throw new RepositoryError('invalid_input','Unexpected consumption reference');
      if (references.length) {
        const inventoryChannel = channel.linked_inventory_channel_id as string | null;
        if (inventoryChannel === null) throw new RepositoryError('not_found','Inventory link is missing');
        await lockChannel(client,'inventory_channels',inventoryChannel);
        const locked = await client.query('SELECT id FROM inventory_items WHERE channel_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE',[inventoryChannel,references.map(ref => ref.inventory_id)]);
        if (locked.rowCount !== references.length) throw new RepositoryError('not_found','Referenced inventory does not exist');
        for (const ref of references) {
          const amount = overrides.get(ref.inventory_id) ?? ref.consume;
          if (/^0(?:\.0+)?$/.test(ref.consume) && !overrides.has(ref.inventory_id)) throw new RepositoryError('invalid_input','Consumption input is required');
          const updated = await client.query('UPDATE inventory_items SET stock=stock-$3::numeric WHERE channel_id=$1 AND id=$2 AND stock>=$3::numeric',[inventoryChannel,ref.inventory_id,amount]);
          if (updated.rowCount !== 1) throw new RepositoryError('shortage',`Insufficient inventory: ${ref.inventory_id}`);
        }
      }
      await client.query(`UPDATE remind_tasks SET last_done_at=$3,next_due_at=$4,last_remind_due_at=NULL,overdue_notify_count=0,
        last_overdue_notified_at=NULL,updated_at=$3,revision=revision+1 WHERE channel_id=$1 AND id=$2`,[channelId,id,completedAt,nextDueAt]);
    });
  }
}
