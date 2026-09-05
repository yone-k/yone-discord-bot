import type { PoolClient } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { assertSchema, EXPECTED_SCHEMA_VERSION } from '../db/schema';
import { TABLES, type Conversion, type MigrationPlan, type Row, type Table } from './conversion';

export interface MigrationReport extends Conversion {
  status: 'validated' | 'imported' | 'already-imported'; snapshot_sha256: string; schema_version: number;
  list_ids: Record<string, string>; source_counts: Record<Table, number>; target_counts: Partial<Record<Table, number>>;
  difference_count: number; differences: string[]; mapped_rows: Record<Table, Row[]>;
}
export function reportFor(data: Conversion, plan: MigrationPlan): MigrationReport {
  return { ...data, status: 'validated', snapshot_sha256: plan.snapshot_sha256, schema_version: EXPECTED_SCHEMA_VERSION,
    list_ids: plan.list_ids, source_counts: Object.fromEntries(TABLES.map(t => [t, data.tables[t].length])) as Record<Table, number>, target_counts: {}, difference_count: 0, differences: [], mapped_rows: data.tables };
}

/** Canonical decimal comparison without converting a quantity to a JS number. */
function numericKey(value: string): string {
  const [coefficient, exponent = '0'] = value.toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  let digits = (whole + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  let scale = Number(exponent) - fraction.length;
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); scale++; }
  return `${digits}e${scale}`;
}
function valueKey(key: string, value: unknown): unknown {
  if (value === null) return null;
  if (key === 'stock' || key === 'consume') return numericKey(String(value));
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function compareDatabase(client: PoolClient, report: MigrationReport): Promise<void> {
  report.differences = [];
  for (const table of TABLES) {
    // Column names derive solely from our closed conversion schema, never from source headers.
    const expected = report.tables[table];
    const actual = (await client.query<Row>(`SELECT * FROM ${table}`)).rows;
    report.target_counts[table] = actual.length;
    if (actual.length !== expected.length) report.differences.push(`${table}: count ${expected.length} != ${actual.length}`);
    const identity = (row: Row): string => JSON.stringify(table === 'remind_task_inventory_items' ? [row.task_channel_id, row.task_id, row.position] : table.endsWith('_channels') ? [row.channel_id] : [row.channel_id, row.id]);
    const map = new Map(actual.map(row => [identity(row), row]));
    for (const source of expected) {
      const target = map.get(identity(source));
      if (!target) { report.differences.push(`${table}: missing ${identity(source)}`); continue; }
      for (const [key, value] of Object.entries(source)) {
        let dbValue: unknown = target[key];
        if (key === 'until' && dbValue instanceof Date) dbValue = `${dbValue.getFullYear()}-${String(dbValue.getMonth() + 1).padStart(2, '0')}-${String(dbValue.getDate()).padStart(2, '0')}`;
        if (JSON.stringify(valueKey(key, value)) !== JSON.stringify(valueKey(key, dbValue))) report.differences.push(`${table}:${identity(source)}:${key} mismatch`);
      }
    }
  }
  report.difference_count = report.differences.length;
  if (report.difference_count) throw new Error(`Database comparison failed: ${report.differences.join('; ')}`);
}

/** Caller owns one transaction, so plan recovery, inserts, verification and marker share one snapshot/lock. */
export async function importRows(client: PoolClient, report: MigrationReport): Promise<MigrationReport> {
  await assertSchema(client);
  const markers = (await client.query('SELECT snapshot_sha256,schema_version,report FROM data_imports')).rows;
  if (markers.length) {
    const marker = markers[0];
    if (markers.length !== 1 || marker.snapshot_sha256 !== report.snapshot_sha256 || marker.schema_version !== report.schema_version || marker.report.snapshot_sha256 !== marker.snapshot_sha256 || marker.report.schema_version !== marker.schema_version || marker.report.difference_count !== 0 || !isDeepStrictEqual(marker.report.list_ids, report.list_ids)) throw new Error('Existing import marker does not match snapshot/plan/schema');
    await compareDatabase(client, report);
    report.status = 'already-imported';
    return report;
  }
  for (const table of TABLES) if ((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) throw new Error(`Nonempty destination: ${table}`);
  for (const table of TABLES) for (const row of report.tables[table]) {
    const columns = Object.keys(row);
    await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
  }
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await compareDatabase(client, report);
  report.status = 'imported';
  await client.query('INSERT INTO data_imports(singleton,snapshot_sha256,schema_version,completed_at,report) VALUES(true,$1,$2,CURRENT_TIMESTAMP,$3::jsonb)', [report.snapshot_sha256, report.schema_version, JSON.stringify(report)]);
  return report;
}
