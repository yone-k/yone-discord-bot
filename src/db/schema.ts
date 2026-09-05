import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { transaction } from './transaction';

export const EXPECTED_SCHEMA_VERSION = 1;
const migrationsDirectory = resolve(__dirname, '../../db/migrations');
type Connection = Pool | PoolClient;

async function migrations(directory = migrationsDirectory): Promise<{version: number; sql: string; checksum: string}[]> {
  const files = (await readdir(directory)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const result = await Promise.all(files.map(async file => {
    const sql = await readFile(resolve(directory, file), 'utf8');
    return { version: Number(file.split('_')[0]), sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  if (result.length !== EXPECTED_SCHEMA_VERSION || result.some((item, i) => item.version !== i + 1)) {
    throw new Error('Migration files do not match expected schema version');
  }
  return result;
}

async function assertPostgresVersion(connection: Connection): Promise<void> {
  const version = (await connection.query('SHOW server_version_num')).rows[0].server_version_num;
  if (Math.floor(Number(version) / 10000) !== 18) throw new Error('PostgreSQL 18 is required');
}

export async function assertSchema(connection: Connection): Promise<void> {
  await assertPostgresVersion(connection);
  const expected = await migrations();
  const { rows } = await connection.query<{ version: number; checksum: string }>('SELECT version, checksum FROM schema_migrations ORDER BY version');
  if (rows.length !== EXPECTED_SCHEMA_VERSION || rows.some((row, i) => row.version !== expected[i].version)) {
    throw new Error('Unexpected database schema version');
  }
  if (rows.some((row, i) => row.checksum !== expected[i].checksum)) throw new Error('Schema migration checksum mismatch');
}

export async function assertReady(connection: Connection): Promise<void> {
  await assertSchema(connection);
  const marker = await connection.query('SELECT singleton FROM data_imports WHERE singleton');
  if (marker.rowCount !== 1) throw new Error('Data import is not complete');
}

export async function applyMigrations(pool: Pool, botRole?: string): Promise<void> {
  const expected = await migrations();
  await transaction(pool, async client => {
    await assertPostgresVersion(client);
    await client.query('SELECT pg_advisory_xact_lock(36001)');
    const exists = (await client.query('SELECT to_regclass(\'public.schema_migrations\') IS NOT NULL AS present')).rows[0].present;
    const applied = exists ? (await client.query<{version: number; checksum: string}>('SELECT version, checksum FROM schema_migrations ORDER BY version')).rows : [];
    if (applied.some((row, i) => row.version !== i + 1 || expected[i]?.checksum !== row.checksum)) throw new Error('Schema migration version or checksum mismatch');
    for (const migration of expected.slice(applied.length)) {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [migration.version,migration.checksum]);
    }
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    if (botRole) await grantBotPermissions(client, botRole);
  });
}

export async function grantBotPermissions(client: PoolClient, botRole: string): Promise<void> {
  const role = '"' + botRole.replace(/"/g, '""') + '"';
  const database = '"' + String((await client.query('SELECT current_database() AS name')).rows[0].name).replace(/"/g, '""') + '"';
  const flags = await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1', [botRole]);
  if (flags.rowCount !== 1 || Object.values(flags.rows[0]).some(Boolean)) throw new Error('Bot role must exist without administration privileges');
  const ownership = await client.query(`SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
    WHERE c.relnamespace='public'::regnamespace AND r.rolname=$1 LIMIT 1`,[botRole]);
  if (ownership.rowCount) throw new Error('Bot role cannot be a schema table owner');
  const databaseOwnership = await client.query(`SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
    WHERE d.datname=current_database() AND r.rolname=$1 UNION ALL SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
    WHERE n.nspname='public' AND r.rolname=$1`,[botRole]);
  if (databaseOwnership.rowCount) throw new Error('Bot role cannot be a database or schema owner');
  const membership = await client.query('SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=$1 LIMIT 1',[botRole]);
  if (membership.rowCount) throw new Error('Bot role must not inherit other roles');
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
  await client.query(`REVOKE ALL ON SCHEMA public FROM ${role}`);
  await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await client.query(`REVOKE ALL ON DATABASE ${database} FROM ${role}`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON list_channels,inventory_channels,remind_channels,list_items,inventory_items,remind_tasks,remind_task_inventory_items TO ${role}`);
  await client.query(`GRANT SELECT ON schema_migrations,data_imports TO ${role}`);
}
