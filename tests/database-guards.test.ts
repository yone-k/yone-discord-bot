import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { applyMigrations } from '../src/db/schema';
import { resetDatabase, testPool } from './db/helpers';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), queries: [] as string[], cluster: '111', version: '180006' }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.exec }));
vi.mock('pg', () => ({
  Pool: class {
    constructor(private options: { onConnect?: (client: unknown) => Promise<void> }) {}
    async query(sql: string): Promise<unknown> {
      const client = { query: async (statement: string): Promise<{ rows: { system_identifier: string; server_version_num: string }[] }> => {
        mocks.queries.push(statement);
        return { rows: [{ system_identifier: mocks.cluster, server_version_num: mocks.version }] };
      } };
      await this.options.onConnect?.(client);
      return client.query(sql);
    }
  }
}));

beforeEach(() => {
  mocks.queries.length = 0;
  mocks.cluster = '111'; mocks.version = '180006';
  mocks.exec.mockReset().mockImplementation((_command: string, args: string[]) => args[0] === 'inspect' ? 'true\n' : '111\n');
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:synthetic@localhost:5432/test');
  vi.stubEnv('TEST_DB_CONTAINER_ID', 'synthetic-container');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('database mutation guards', () => {
  it('rejects a non-18 server before applying DDL or permissions', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'SHOW server_version_num') return { rows: [{ server_version_num: '170005' }] };
      if (sql.includes('to_regclass')) return { rows: [{ present: false }] };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: async () => client as unknown as PoolClient } as Pool;
    await expect(applyMigrations(pool)).rejects.toThrow('PostgreSQL 18');
    expect(query.mock.calls.some(([sql]) => /CREATE TABLE|REVOKE|INSERT INTO schema_migrations/.test(sql))).toBe(false);
  });

  it('rejects a connection to a different cluster before destructive reset', async () => {
    mocks.cluster = '222';
    await expect(resetDatabase(testPool())).rejects.toThrow('cluster');
    expect(mocks.queries.some(sql => sql.includes('DROP SCHEMA'))).toBe(false);
  });

  it('rejects non-18 test connections before destructive reset', async () => {
    mocks.version = '170005';
    await expect(resetDatabase(testPool())).rejects.toThrow('PostgreSQL 18');
    expect(mocks.queries.some(sql => sql.includes('DROP SCHEMA'))).toBe(false);
  });

  it('permits reset after the cluster and major version match', async () => {
    await resetDatabase(testPool());
    expect(mocks.queries.some(sql => sql.includes('DROP SCHEMA'))).toBe(true);
    expect(mocks.exec.mock.calls.some(([, args]) => args.includes('psql'))).toBe(true);
  });
});
