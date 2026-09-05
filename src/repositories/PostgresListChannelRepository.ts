import type { Pool } from 'pg';
import { getPool } from '../db/pool';
import { transaction } from '../db/transaction';
import type { ListChannel, ListChannelRepository } from './contracts';
import { camelRow, lockChannel, patchColumns, requireRow } from './sql';

const columns = { messageId: 'message_id', listTitle: 'list_title', defaultCategory: 'default_category', operationLogThreadId: 'operation_log_thread_id' };
export class PostgresListChannelRepository implements ListChannelRepository {
  constructor(private readonly pool: Pool = getPool()) {}
  async get(channelId: string): Promise<ListChannel | null> {
    const {rows} = await this.pool.query('SELECT * FROM list_channels WHERE channel_id=$1',[channelId]);
    return rows[0] ? camelRow<ListChannel>(rows[0]) : null;
  }
  async list(): Promise<ListChannel[]> { return (await this.pool.query('SELECT * FROM list_channels ORDER BY channel_id')).rows.map(row => camelRow<ListChannel>(row)); }
  async save(channel: Omit<ListChannel,'editVersion'>): Promise<void> {
    await this.pool.query(`INSERT INTO list_channels(channel_id,message_id,list_title,default_category,operation_log_thread_id) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(channel_id) DO UPDATE SET message_id=EXCLUDED.message_id,list_title=EXCLUDED.list_title,default_category=EXCLUDED.default_category,
      operation_log_thread_id=EXCLUDED.operation_log_thread_id, edit_version=list_channels.edit_version +
      CASE WHEN (list_channels.list_title,list_channels.default_category,list_channels.operation_log_thread_id) IS DISTINCT FROM
      (EXCLUDED.list_title,EXCLUDED.default_category,EXCLUDED.operation_log_thread_id) THEN 1 ELSE 0 END`,
    [channel.channelId,channel.messageId,channel.listTitle,channel.defaultCategory,channel.operationLogThreadId]);
  }
  async patch(channelId: string, changes: Partial<Omit<ListChannel,'channelId'|'editVersion'>>): Promise<void> {
    const [names, values] = patchColumns(changes, columns);
    if (!names.length) return;
    await transaction(this.pool,async client => {
      const current = await lockChannel(client,'list_channels',channelId);
      const businessChanged = names.some((name,i) => name !== 'message_id' && current[name] !== values[i]);
      await client.query(`UPDATE list_channels SET ${names.map((name,i) => `${name}=$${i+2}`).join(',')},edit_version=edit_version+$${values.length+2} WHERE channel_id=$1`,[channelId,...values,businessChanged ? 1 : 0]);
    });
  }
  async setMessageId(channelId: string, messageId: string | null): Promise<void> { await this.patch(channelId,{messageId}); }
  async delete(channelId: string): Promise<void> { requireRow((await this.pool.query('DELETE FROM list_channels WHERE channel_id=$1',[channelId])).rowCount); }
}
