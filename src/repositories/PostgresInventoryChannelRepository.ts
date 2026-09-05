import type { Pool } from 'pg';
import { getPool } from '../db/pool';
import type { InventoryChannel, InventoryChannelRepository } from './contracts';
import { camelRow, patchColumns, requireRow } from './sql';

const columns = { messageId: 'message_id', listTitle: 'list_title', defaultCategory: 'default_category', operationLogThreadId: 'operation_log_thread_id' };
export class PostgresInventoryChannelRepository implements InventoryChannelRepository {
  constructor(private readonly pool: Pool = getPool()) {}
  async get(channelId: string): Promise<InventoryChannel | null> {
    const {rows} = await this.pool.query('SELECT * FROM inventory_channels WHERE channel_id=$1',[channelId]);
    return rows[0] ? camelRow<InventoryChannel>(rows[0]) : null;
  }
  async list(): Promise<InventoryChannel[]> { return (await this.pool.query('SELECT * FROM inventory_channels ORDER BY channel_id')).rows.map(row => camelRow<InventoryChannel>(row)); }
  async save(channel: InventoryChannel): Promise<void> {
    await this.pool.query(`INSERT INTO inventory_channels(channel_id,message_id,list_title,default_category,operation_log_thread_id) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(channel_id) DO UPDATE SET message_id=EXCLUDED.message_id,list_title=EXCLUDED.list_title,default_category=EXCLUDED.default_category,operation_log_thread_id=EXCLUDED.operation_log_thread_id`,
    [channel.channelId,channel.messageId,channel.listTitle,channel.defaultCategory,channel.operationLogThreadId]);
  }
  async patch(channelId: string, changes: Partial<Omit<InventoryChannel,'channelId'>>): Promise<void> {
    const [names, values] = patchColumns(changes,columns);
    if (!names.length) return;
    requireRow((await this.pool.query(`UPDATE inventory_channels SET ${names.map((name,i) => `${name}=$${i+2}`).join(',')} WHERE channel_id=$1`,[channelId,...values])).rowCount);
  }
  async delete(channelId: string): Promise<void> { requireRow((await this.pool.query('DELETE FROM inventory_channels WHERE channel_id=$1',[channelId])).rowCount); }
}
