import type { Pool } from 'pg';
import { getPool } from '../db/pool';
import { transaction } from '../db/transaction';
import { RepositoryError, type InventoryRepository, type StoredInventoryItem } from './contracts';
import { camelRow, decimal, lockChannel, requireRow } from './sql';
import { randomUUID } from 'node:crypto';
import { normalizeDecimal } from '../utils/Decimal';

type Item = Omit<StoredInventoryItem,'channelId'|'position'>;
export class PostgresInventoryRepository implements InventoryRepository {
  constructor(private readonly pool: Pool = getPool()) {}
  async apply(channelId: string, expected: Item[], items: Item[]): Promise<void> {
    const ids = new Set<string>(), names = new Set<string>();
    for (const item of items) {
      decimal(item.stock);
      if (!item.id || !item.name.trim() || ids.has(item.id) || names.has(item.name)) {
        throw new RepositoryError('invalid_input', '在庫のIDまたは名前が空・重複しています');
      }
      ids.add(item.id); names.add(item.name);
    }
    try {
      await transaction(this.pool, async client => {
        await lockChannel(client, 'inventory_channels', channelId);
        const current = (await client.query('SELECT * FROM inventory_items WHERE channel_id=$1 ORDER BY id FOR UPDATE', [channelId])).rows.map(row => camelRow<StoredInventoryItem>(row)).sort((a,b)=>a.position-b.position);
        const same = (a: Item, b: Item): boolean => a.id === b.id && a.name === b.name && a.category === b.category && normalizeDecimal(a.stock) === normalizeDecimal(b.stock);
        if (current.length !== expected.length || current.some((item, index) => !same(item, expected[index]))) {
          throw new RepositoryError('conflict', '在庫が更新されました。編集画面を開き直してください。');
        }
        await client.query('DELETE FROM inventory_items WHERE channel_id=$1 AND NOT(id=ANY($2::text[]))', [channelId, [...ids]]);
        const currentById = new Map(current.map(item => [item.id, item]));
        // 名称の一意制約を保ちながら、既存ID同士の名称入替えを可能にする。
        for (const item of items) {
          if (currentById.has(item.id) && currentById.get(item.id)!.name !== item.name) {
            await client.query('UPDATE inventory_items SET name=$3 WHERE channel_id=$1 AND id=$2', [channelId, item.id, `editing-${randomUUID()}`]);
          }
        }
        for (const [position, item] of items.entries()) {
          await client.query(`INSERT INTO inventory_items(channel_id,id,name,stock,category,position) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(channel_id,id) DO UPDATE SET name=EXCLUDED.name,stock=EXCLUDED.stock,category=EXCLUDED.category,position=EXCLUDED.position`,
          [channelId,item.id,item.name,item.stock,item.category,position]);
        }
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === '23001' || error.code === '23503')) {
        throw new RepositoryError('referenced', 'リマインドから参照されている在庫は削除できません。変更は保存していません。');
      }
      throw error;
    }
  }
  async fetchAll(channelId: string): Promise<StoredInventoryItem[]> {
    return (await this.pool.query('SELECT * FROM inventory_items WHERE channel_id=$1 ORDER BY position',[channelId])).rows.map(row => camelRow<StoredInventoryItem>(row));
  }
  async findById(channelId: string,id: string): Promise<StoredInventoryItem | null> {
    const {rows} = await this.pool.query('SELECT * FROM inventory_items WHERE channel_id=$1 AND id=$2',[channelId,id]);
    return rows[0] ? camelRow<StoredInventoryItem>(rows[0]) : null;
  }
  async findByName(channelId: string,name: string): Promise<StoredInventoryItem | null> {
    const {rows} = await this.pool.query('SELECT * FROM inventory_items WHERE channel_id=$1 AND name=$2',[channelId,name]);
    return rows[0] ? camelRow<StoredInventoryItem>(rows[0]) : null;
  }
  async append(channelId: string,item: Item): Promise<void> {
    decimal(item.stock);
    await transaction(this.pool,async client => {
      await lockChannel(client,'inventory_channels',channelId);
      await client.query(`INSERT INTO inventory_items(channel_id,id,name,stock,category,position) VALUES($1,$2,$3,$4,$5,
        (SELECT COALESCE(MAX(position)+1,0) FROM inventory_items WHERE channel_id=$1))`,[channelId,item.id,item.name,item.stock,item.category]);
    });
  }
  async update(channelId: string,item: Item): Promise<void> { await this.bulkUpdate(channelId,[item]); }
  async bulkUpdate(channelId: string,items: Item[]): Promise<void> {
    for (const item of items) decimal(item.stock);
    await transaction(this.pool,async client => {
      await lockChannel(client,'inventory_channels',channelId);
      for (const item of [...items].sort((a,b) => a.id.localeCompare(b.id))) {
        requireRow((await client.query('UPDATE inventory_items SET name=$3,stock=$4,category=$5 WHERE channel_id=$1 AND id=$2',[channelId,item.id,item.name,item.stock,item.category])).rowCount);
      }
    });
  }
  async delete(channelId: string,id: string): Promise<void> {
    try {
      await transaction(this.pool,async client => {
        await lockChannel(client,'inventory_channels',channelId);
        requireRow((await client.query('DELETE FROM inventory_items WHERE channel_id=$1 AND id=$2',[channelId,id])).rowCount);
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === '23001' || error.code === '23503')) {
        throw new RepositoryError('referenced','Inventory is referenced by reminder tasks');
      }
      throw error;
    }
  }
  async reorder(channelId: string,ids: string[]): Promise<void> {
    await transaction(this.pool,async client => {
      await lockChannel(client,'inventory_channels',channelId);
      const rows = (await client.query('SELECT id FROM inventory_items WHERE channel_id=$1 ORDER BY id FOR UPDATE',[channelId])).rows;
      if (new Set(ids).size !== ids.length || rows.length !== ids.length || rows.some(row => !ids.includes(row.id))) throw new RepositoryError('invalid_input','Reordering requires every item exactly once');
      for (const [position,id] of ids.entries()) await client.query('UPDATE inventory_items SET position=$3 WHERE channel_id=$1 AND id=$2',[channelId,id,position]);
    });
  }
}
