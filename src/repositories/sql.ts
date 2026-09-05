import type { PoolClient } from 'pg';
import { RepositoryError } from './contracts';

export function camelRow<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([key,value]) => [key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),value])) as T;
}

export async function lockChannel(client: PoolClient, table: 'list_channels' | 'inventory_channels' | 'remind_channels', channelId: string): Promise<Record<string, unknown>> {
  const result = await client.query(`SELECT * FROM ${table} WHERE channel_id=$1 FOR UPDATE`, [channelId]);
  if (!result.rows[0]) throw new RepositoryError('not_found', 'Channel is not registered');
  return result.rows[0];
}

export function requireRow(count: number | null): void {
  if (!count) throw new RepositoryError('not_found', 'Item does not exist');
}

export function decimal(value: string): void {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new RepositoryError('invalid_input', 'Quantity must be a nonnegative decimal string');
}

export function patchColumns(changes: Record<string, unknown>, columns: Record<string, string>): [string[], unknown[]] {
  const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
  if (entries.some(([key]) => !Object.prototype.hasOwnProperty.call(columns, key))) throw new RepositoryError('invalid_input', 'Unknown channel setting');
  return [entries.map(([key]) => columns[key]), entries.map(([,value]) => value)];
}
