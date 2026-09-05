import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, assertSchema, assertReady } from '../../src/db/schema';
import { resetDatabase, testPool } from './helpers';
import { closePool, getPool } from '../../src/db/pool';

describe('PostgreSQL schema lifecycle', () => {
  const pool = testPool();
  beforeAll(async () => { expect((await pool.query('SHOW server_version_num')).rows[0].server_version_num).toMatch(/^18/); });
  beforeEach(async () => { await resetDatabase(pool); });
  afterAll(async () => { await pool.end(); });

  it('applies all nine tables atomically and does not apply the same migration twice', async () => {
    await applyMigrations(pool);
    await applyMigrations(pool);
    const tables = await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=\'public\'');
    expect(tables.rowCount).toBe(9);
    expect((await pool.query('SELECT * FROM schema_migrations')).rowCount).toBe(1);
    await expect(assertSchema(pool)).resolves.toBeUndefined();
  });

  it('rejects schema checksum corruption and rejects startup before data import', async () => {
    await applyMigrations(pool);
    await expect(assertReady(pool)).rejects.toThrow(/import/i);
    await pool.query('UPDATE schema_migrations SET checksum=repeat(\'a\',64)');
    await expect(assertSchema(pool)).rejects.toThrow(/checksum/i);
  });

  it('requires both the expected schema and singleton import marker for readiness', async () => {
    await applyMigrations(pool);
    await pool.query('INSERT INTO data_imports(snapshot_sha256,schema_version,completed_at,report) VALUES(repeat(\'a\',64),1,now(),\'{}\')');
    await expect(assertReady(pool)).resolves.toBeUndefined();
    await expect(pool.query('INSERT INTO data_imports(snapshot_sha256,schema_version,completed_at,report) VALUES(repeat(\'b\',64),1,now(),\'{}\')')).rejects.toThrow();
  });

  it('gives the Bot only business DML and management SELECT, without DDL or truncate', async () => {
    await pool.query('DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=\'issue36_bot_test\') THEN DROP OWNED BY issue36_bot_test; DROP ROLE issue36_bot_test; END IF; END $$');
    await pool.query('CREATE ROLE issue36_bot_test NOLOGIN');
    await applyMigrations(pool,'issue36_bot_test');
    const client = await pool.connect();
    try {
      await client.query('SET ROLE issue36_bot_test');
      await client.query('INSERT INTO list_channels(channel_id,list_title) VALUES(\'99\',\'Test\')');
      expect((await client.query('SELECT * FROM schema_migrations')).rowCount).toBe(1);
      for (const sql of ['CREATE TABLE forbidden(id int)','CREATE TEMP TABLE forbidden_temp(id int)','TRUNCATE list_channels','DELETE FROM schema_migrations','INSERT INTO data_imports(snapshot_sha256,schema_version,completed_at,report) VALUES(repeat(\'a\',64),1,now(),\'{}\')'])
        await expect(client.query(sql)).rejects.toThrow(/permission denied/);
    } finally { await client.query('RESET ROLE'); client.release(); }
  });

  it('refuses granting runtime privileges to the schema owner', async () => {
    await pool.query('DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=\'issue36_owner_test\') THEN DROP OWNED BY issue36_owner_test; DROP ROLE issue36_owner_test; END IF; END $$');
    await pool.query('CREATE ROLE issue36_owner_test NOLOGIN');
    await applyMigrations(pool);
    await pool.query('ALTER TABLE list_items OWNER TO issue36_owner_test');
    await expect(applyMigrations(pool,'issue36_owner_test')).rejects.toThrow(/owner/i);
  });

  it('configures UTC on every runtime connection independently of PGOPTIONS', async () => {
    vi.stubEnv('PGOPTIONS','-c timezone=Asia/Tokyo');
    const connectionUrl = new URL(process.env.DATABASE_URL!);
    connectionUrl.searchParams.set('options','-c timezone=Asia/Tokyo');
    vi.stubEnv('DATABASE_URL',connectionUrl.toString());
    await closePool();
    try {
      const runtimePool = getPool();
      const clients = await Promise.all([runtimePool.connect(),runtimePool.connect()]);
      try {
        for (const client of clients) expect((await client.query('SHOW TIME ZONE')).rows[0].TimeZone).toBe('UTC');
      } finally { clients.forEach(client => client.release()); }
    } finally { await closePool(); vi.unstubAllEnvs(); }
  });
});
