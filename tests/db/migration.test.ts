import { mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool, resetDatabase } from './helpers';
import { applyMigrations } from '../../src/db/schema';
import { runMigration } from '../../src/migration/runner';
import { fixture } from '../migration/fixture';

const pool = testPool();
let directory: string;
let snapshot: string;
beforeEach(async () => {
  if (directory) await rm(directory, { recursive: true });
  directory = await mkdtemp(join(tmpdir(), 'migration-db-'));
  snapshot = join(directory, 'snapshot.json');
  await resetDatabase(pool);
  await applyMigrations(pool);
  const input = fixture();
  input.sheets[3].rows.push(['第二項目', '', '', '1', '']);
  await writeFile(snapshot, JSON.stringify(input));
});
afterAll(async () => { await pool.end(); if (directory) await rm(directory, { recursive: true }); });
const run = (): ReturnType<typeof runMigration> => runMigration({ snapshot, databaseUrl: process.env.DATABASE_URL });

describe('initial import transaction', () => {
  it('imports every field and reruns without duplicate inserts, recovering lost UUID plan', async () => {
    const first = await run();
    expect(first.status).toBe('imported');
    expect(first.difference_count).toBe(0);
    expect((await pool.query('SELECT stock::text FROM inventory_items')).rows[0].stock).toBe('12345678901234567890.123456789');
    await unlink(join(directory, 'migration-plan.json'));
    const repeat = await run();
    expect(repeat.status).toBe('already-imported');
    expect(repeat.list_ids).toEqual(first.list_ids);
    expect((await pool.query('SELECT count(*)::int AS count FROM list_items')).rows[0].count).toBe(2);
  });
  it('rejects any changed destination value without overwriting it', async () => {
    await run();
    await pool.query('UPDATE list_items SET last_notified_at=\'2026-09-05T00:00:00.002Z\' WHERE name=\'牛乳\'');
    await expect(run()).rejects.toThrow('comparison');
    expect((await pool.query('SELECT count(*)::int AS count FROM list_items')).rows[0].count).toBe(2);
  });
  it('compares UUID mappings by entries, not JSON object property order', async () => {
    const first = await run();
    const path = join(directory, 'migration-plan.json');
    const plan = JSON.parse(await readFile(path, 'utf8'));
    plan.list_ids = Object.fromEntries(Object.entries(plan.list_ids).reverse());
    await writeFile(path, JSON.stringify(plan));
    const repeat = await run();
    expect(repeat.list_ids).toEqual(first.list_ids);
  });
  it('rolls back all tables if verification detects a database-side changed field', async () => {
    await pool.query('CREATE FUNCTION alter_title() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.title := \'unexpected\'; RETURN NEW; END $$; CREATE TRIGGER mutate BEFORE INSERT ON remind_tasks FOR EACH ROW EXECUTE FUNCTION alter_title()');
    await expect(run()).rejects.toThrow('comparison');
    expect((await pool.query('SELECT count(*)::int AS count FROM list_channels')).rows[0].count).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM data_imports')).rows[0].count).toBe(0);
  });
  it('rejects nonempty destinations without an import marker', async () => {
    await pool.query('INSERT INTO list_channels(channel_id,list_title) VALUES(\'999\',\'existing\')');
    await expect(run()).rejects.toThrow('Nonempty');
    expect((await pool.query('SELECT count(*)::int AS count FROM inventory_channels')).rows[0].count).toBe(0);
  });
  it('rejects a different snapshot when the UUID plan is absent', async () => {
    await run();
    await unlink(join(directory, 'migration-plan.json'));
    await writeFile(snapshot, JSON.stringify(fixture()));
    await expect(run()).rejects.toThrow('SHA');
    expect((await pool.query('SELECT count(*)::int AS count FROM list_items')).rows[0].count).toBe(2);
  });
  it('rejects inconsistent marker report identity', async () => {
    await run();
    await pool.query('UPDATE data_imports SET report=jsonb_set(report,\'{schema_version}\',\'999\')');
    await expect(run()).rejects.toThrow('marker');
  });
  it('dry-run performs no DB writes even if a database URL is supplied', async () => {
    const result = await runMigration({ snapshot, databaseUrl: process.env.DATABASE_URL, dryRun: true });
    expect(result.status).toBe('validated');
    expect((await pool.query('SELECT count(*)::int AS count FROM list_channels')).rows[0].count).toBe(0);
    expect(JSON.parse(await readFile(join(directory, 'migration-plan.json'), 'utf8')).list_ids).toEqual(result.list_ids);
  });
  it('dry-run with a destination recovers an imported UUID map instead of generating new IDs', async () => {
    const first = await run();
    await unlink(join(directory, 'migration-plan.json'));
    const dryRun = await runMigration({ snapshot, databaseUrl: process.env.DATABASE_URL, dryRun: true });
    expect(dryRun.list_ids).toEqual(first.list_ids);
  });
});
