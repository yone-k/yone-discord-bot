import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool';
import { transaction } from '../db/transaction';
import { RepositoryError, type RemindChannel, type RemindChannelRepository } from './contracts';
import { camelRow, lockChannel, patchColumns, requireRow } from './sql';

const columns = {messageId:'message_id',listTitle:'list_title',operationLogThreadId:'operation_log_thread_id',remindNoticeThreadId:'remind_notice_thread_id',remindNoticeMessageId:'remind_notice_message_id',linkedInventoryChannelId:'linked_inventory_channel_id'};
export class PostgresRemindChannelRepository implements RemindChannelRepository {
  constructor(private readonly pool: Pool = getPool()) {}
  async get(channelId: string): Promise<RemindChannel | null> {
    const {rows} = await this.pool.query('SELECT * FROM remind_channels WHERE channel_id=$1',[channelId]);
    return rows[0] ? camelRow<RemindChannel>(rows[0]) : null;
  }
  async list(): Promise<RemindChannel[]> { return (await this.pool.query('SELECT * FROM remind_channels ORDER BY channel_id')).rows.map(row => camelRow<RemindChannel>(row)); }
  async linkedTo(channelId: string): Promise<RemindChannel[]> { return (await this.pool.query('SELECT * FROM remind_channels WHERE linked_inventory_channel_id=$1 ORDER BY channel_id',[channelId])).rows.map(row => camelRow<RemindChannel>(row)); }
  private async checkLink(client: PoolClient, channelId: string, linked: string | null): Promise<void> {
    await client.query('SELECT id FROM remind_tasks WHERE channel_id=$1 ORDER BY id FOR UPDATE',[channelId]);
    if (linked === null && (await client.query('SELECT 1 FROM remind_task_inventory_items WHERE task_channel_id=$1 LIMIT 1',[channelId])).rowCount) {
      throw new RepositoryError('referenced','Remove task inventory references before unlinking');
    }
    if (linked !== null) {
      await lockChannel(client,'inventory_channels',linked);
      await client.query(`SELECT id FROM inventory_items WHERE channel_id=$1 AND id IN
        (SELECT inventory_id FROM remind_task_inventory_items WHERE task_channel_id=$2) ORDER BY id FOR UPDATE`,[linked,channelId]);
    }
  }
  async save(channel: RemindChannel): Promise<void> {
    await transaction(this.pool,async client => {
      // An advisory lock also serializes creation before the parent row exists.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,36))',[channel.channelId]);
      await client.query('SELECT channel_id FROM remind_channels WHERE channel_id=$1 FOR UPDATE',[channel.channelId]);
      await this.checkLink(client,channel.channelId,channel.linkedInventoryChannelId);
      await client.query(`INSERT INTO remind_channels(channel_id,message_id,list_title,operation_log_thread_id,remind_notice_thread_id,remind_notice_message_id,linked_inventory_channel_id)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(channel_id) DO UPDATE SET message_id=EXCLUDED.message_id,list_title=EXCLUDED.list_title,
        operation_log_thread_id=EXCLUDED.operation_log_thread_id,remind_notice_thread_id=EXCLUDED.remind_notice_thread_id,
        remind_notice_message_id=EXCLUDED.remind_notice_message_id,linked_inventory_channel_id=EXCLUDED.linked_inventory_channel_id`,
      [channel.channelId,channel.messageId,channel.listTitle,channel.operationLogThreadId,channel.remindNoticeThreadId,channel.remindNoticeMessageId,channel.linkedInventoryChannelId]);
    });
  }
  async patch(channelId: string, changes: Partial<Omit<RemindChannel,'channelId'>>): Promise<void> {
    const [names, values] = patchColumns(changes,columns);
    if (!names.length) return;
    await transaction(this.pool,async client => {
      await lockChannel(client,'remind_channels',channelId);
      if (changes.linkedInventoryChannelId !== undefined) await this.checkLink(client,channelId,changes.linkedInventoryChannelId);
      await client.query(`UPDATE remind_channels SET ${names.map((name,i) => `${name}=$${i+2}`).join(',')} WHERE channel_id=$1`,[channelId,...values]);
    });
  }
  async delete(channelId: string): Promise<void> { requireRow((await this.pool.query('DELETE FROM remind_channels WHERE channel_id=$1',[channelId])).rowCount); }
}
