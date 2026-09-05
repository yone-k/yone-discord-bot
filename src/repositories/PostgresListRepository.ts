import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool';
import { transaction } from '../db/transaction';
import { RepositoryError, type DayBounds, type ListEditItem, type ListRepository, type ListSnapshot, type StoredListItem } from './contracts';
import { camelRow, lockChannel, requireRow } from './sql';

const selectColumns = 'id,channel_id,name,category,until::text,is_completed,last_notified_at,position';
function validate(items: ListEditItem[]): void {
  const names = new Set<string>();
  items.forEach((item,i) => {
    if (!item.name.trim() || names.has(item.name)) throw new RepositoryError('invalid_input',`Invalid or duplicate name on row ${i+1}`);
    names.add(item.name);
    if (item.until !== null && !/^\d{4}-\d{2}-\d{2}$/.test(item.until)) throw new RepositoryError('invalid_input',`Invalid date on row ${i+1}`);
  });
}
export class PostgresListRepository implements ListRepository {
  constructor(private readonly pool: Pool = getPool()) {}
  private async read(client: Pool | PoolClient,channelId: string): Promise<StoredListItem[]> {
    return (await client.query(`SELECT ${selectColumns} FROM list_items WHERE channel_id=$1 ORDER BY position`,[channelId])).rows.map(row => camelRow<StoredListItem>(row));
  }
  async fetchAll(channelId: string): Promise<StoredListItem[]> { return this.read(this.pool,channelId); }
  async snapshot(channelId: string): Promise<ListSnapshot> {
    return transaction(this.pool,async client => {
      const channel = await client.query('SELECT edit_version FROM list_channels WHERE channel_id=$1',[channelId]);
      requireRow(channel.rowCount);
      return {editVersion:channel.rows[0].edit_version,items:await this.read(client,channelId)};
    },true);
  }
  async save(channelId: string,expectedVersion: string,items: ListEditItem[]): Promise<void> {
    validate(items);
    await transaction(this.pool,async client => {
      const channel = await lockChannel(client,'list_channels',channelId);
      if (channel.edit_version !== expectedVersion) throw new RepositoryError('conflict','一覧が更新されています。編集画面を開き直してください');
      await client.query('DELETE FROM list_items WHERE channel_id=$1 AND NOT(name=ANY($2::text[]))',[channelId,items.map(item => item.name)]);
      for (const [position,item] of items.entries()) {
        await client.query(`INSERT INTO list_items(channel_id,name,category,until,is_completed,position) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(channel_id,name) DO UPDATE SET category=EXCLUDED.category,until=EXCLUDED.until,is_completed=EXCLUDED.is_completed,position=EXCLUDED.position`,
        [channelId,item.name,item.category,item.until,item.isCompleted,position]);
      }
      await client.query('UPDATE list_channels SET edit_version=edit_version+1 WHERE channel_id=$1',[channelId]);
    });
  }
  async append(channelId: string,item: ListEditItem): Promise<StoredListItem> {
    validate([item]);
    return transaction(this.pool,async client => {
      await lockChannel(client,'list_channels',channelId);
      const result = await client.query(`INSERT INTO list_items(channel_id,name,category,until,is_completed,position)
        VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(position)+1,0) FROM list_items WHERE channel_id=$1)) RETURNING ${selectColumns}`,
      [channelId,item.name,item.category,item.until,item.isCompleted]);
      await client.query('UPDATE list_channels SET edit_version=edit_version+1 WHERE channel_id=$1',[channelId]);
      return camelRow<StoredListItem>(result.rows[0]);
    });
  }
  async update(channelId: string,id: string,item: ListEditItem): Promise<void> {
    validate([item]);
    await transaction(this.pool,async client => {
      await lockChannel(client,'list_channels',channelId);
      requireRow((await client.query('UPDATE list_items SET name=$3,category=$4,until=$5,is_completed=$6 WHERE channel_id=$1 AND id=$2',[channelId,id,item.name,item.category,item.until,item.isCompleted])).rowCount);
      await client.query('UPDATE list_channels SET edit_version=edit_version+1 WHERE channel_id=$1',[channelId]);
    });
  }
  async delete(channelId: string,id: string): Promise<void> {
    await transaction(this.pool,async client => {
      await lockChannel(client,'list_channels',channelId);
      requireRow((await client.query('DELETE FROM list_items WHERE channel_id=$1 AND id=$2',[channelId,id])).rowCount);
      await client.query('UPDATE list_channels SET edit_version=edit_version+1 WHERE channel_id=$1',[channelId]);
    });
  }
  async notificationCandidates(day: DayBounds): Promise<StoredListItem[]> {
    return (await this.pool.query(`SELECT i.id,i.channel_id,i.name,i.category,i.until::text,i.is_completed,i.last_notified_at,i.position
      FROM list_items i JOIN list_channels c USING(channel_id) WHERE i.until=$1 AND NOT i.is_completed
      AND c.operation_log_thread_id IS NOT NULL AND (i.last_notified_at IS NULL OR i.last_notified_at<$2 OR i.last_notified_at>=$3)
      ORDER BY i.channel_id,i.position`,[day.date,day.start,day.end])).rows.map(row => camelRow<StoredListItem>(row));
  }
  async reorder(channelId: string,ids: string[]): Promise<void> {
    await transaction(this.pool,async client => {
      await lockChannel(client,'list_channels',channelId);
      const rows = (await client.query('SELECT id FROM list_items WHERE channel_id=$1 ORDER BY id FOR UPDATE',[channelId])).rows;
      if (new Set(ids).size !== ids.length || rows.length !== ids.length || rows.some(row => !ids.includes(row.id))) throw new RepositoryError('invalid_input','Reordering requires every item exactly once');
      for (const [position,id] of ids.entries()) await client.query('UPDATE list_items SET position=$3 WHERE channel_id=$1 AND id=$2',[channelId,id,position]);
      await client.query('UPDATE list_channels SET edit_version=edit_version+1 WHERE channel_id=$1',[channelId]);
    });
  }
  async markNotified(id: string,until: string,notifiedAt: Date): Promise<boolean> {
    return (await this.pool.query('UPDATE list_items SET last_notified_at=$3 WHERE id=$1 AND until=$2 AND NOT is_completed',[id,until,notifiedAt])).rowCount === 1;
  }
}
