import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, assertReady } from '../../src/db/schema';
import { runMigration } from '../../src/migration/runner';
import { fixture } from '../migration/fixture';
import { TABLES } from '../../src/migration/conversion';
import { testPool } from './helpers';

// PostgreSQL commands and the deployed shell/Python orchestration run unchanged.
// Only Pi mount/systemd/flock/Bot-state boundaries and Google Drive are simulated.
// The Docker adapter translates Compose's service selector into the supplied real
// test container, preserving stdin/stdout and executing its actual PostgreSQL 18 tools.
let admin: Pool;
let source: Pool;
let restored: Pool | undefined;
let bot: Pool | undefined;
let directory: string;
let sourceDatabase: string;
let targetDatabase: string;
let botRole: string;
let environment: NodeJS.ProcessEnv;
const quote = (value: string): string => `'${value.replace(/'/g, '\'\\\'\'')}'`;

async function executable(name: string, text: string): Promise<void> {
  const path = join(directory, 'bin', name);
  await writeFile(path, text);
  await chmod(path, 0o700);
}

function urlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  return url.toString();
}

beforeEach(async () => {
  admin = testPool();
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  sourceDatabase = `backup_source_${id}`;
  targetDatabase = `backup_target_${id}`;
  botRole = `backup_bot_${id}`;
  await admin.query(`CREATE ROLE ${botRole} LOGIN PASSWORD 'issue36-local-only'`);
  await admin.query(`CREATE DATABASE ${sourceDatabase}`);
  source = new Pool({ connectionString: urlFor(sourceDatabase), max: 1 });
  directory = await mkdtemp(join(tmpdir(), 'postgres-backup-integration-'));
  for (const subdirectory of ['bin', 'scripts', 'deploy', '.deploy-state', 'storage/postgres', 'drive']) await mkdir(join(directory, subdirectory), { recursive: true });
  for (const path of ['scripts/pi-backup.sh', 'scripts/pi-restore.sh', 'scripts/pi-db-preflight.sh', 'deploy/postgres-backup.py']) await copyFile(resolve(path), join(directory, path));
  await writeFile(join(directory, '.env.storage'), `STORAGE_UUID=synthetic-test-uuid\nSTORAGE_ROOT=${quote(join(directory, 'storage'))}\n`);
  await writeFile(join(directory, '.env.backup'), `RCLONE_REMOTE=bot-drive:\nBOT_IMAGE=ghcr.io/yone-k/yone-discord-bot@sha256:${'a'.repeat(64)}\n`);
  await writeFile(join(directory, 'storage/postgres/.discord-bot-disk'), 'synthetic-test-uuid\n');
  await writeFile(join(directory, '.deploy-state/ci-disabled'), '');
  await writeFile(join(directory, '.deploy-state/state'), 'blocked=1\n');
  const docker = execFileSync('which', ['docker'], { encoding: 'utf8' }).trim();
  const username = decodeURIComponent(new URL(process.env.DATABASE_URL!).username);
  await executable('docker', `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if not args or args.pop(0) != 'compose': raise SystemExit('Only Compose calls are expected')
if args[:1] == ['-p']: args = args[2:]
if args == ['ps', '--status', 'running', '-q', 'bot']: raise SystemExit(0)
if args[:3] != ['exec', '-T', 'db']: raise SystemExit('Unexpected Compose operation')
with open(os.environ['COMMAND_LOG'], 'a') as log: log.write(json.dumps(args) + '\\n')
actual = [os.environ['REAL_DOCKER'], 'exec', '-i', '-e', 'POSTGRES_DB=' + os.environ['SOURCE_DATABASE'], '-e', 'POSTGRES_USER=' + os.environ['DATABASE_USER'], os.environ['TEST_DB_CONTAINER_ID']] + args[3:]
os.execv(actual[0], actual)
`);
  await executable('findmnt', '#!/bin/bash\ncase "${!#}" in UUID) echo synthetic-test-uuid;; FSTYPE) echo ext4;; OPTIONS) echo rw;; *) exit 1;; esac\n');
  await executable('systemctl', '#!/bin/bash\nexit 3\n');
  await executable('flock', '#!/bin/bash\nexit 0\n');
  await executable('rclone', `#!/usr/bin/env python3
import json, os, pathlib, shutil, sys
args = sys.argv[1:]
with open(os.environ['TRANSFER_LOG'], 'a') as log: log.write(json.dumps(args) + '\\n')
def path(value):
    if value.startswith('bot-drive:'):
        name = value[len('bot-drive:'):]
        if pathlib.Path(name).name != name: raise ValueError('Invalid Drive object')
        return pathlib.Path(os.environ['MOCK_DRIVE']) / name
    return pathlib.Path(value)
if args[0] == 'copyto': shutil.copyfile(path(args[1]), path(args[2]))
elif args[0] == 'deletefile': path(args[1]).unlink(missing_ok=True)
else: raise SystemExit('Unexpected rclone operation')
`);
  environment = { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`, REAL_DOCKER: docker, SOURCE_DATABASE: sourceDatabase, DATABASE_USER: username,
    MOCK_DRIVE: join(directory, 'drive'), COMMAND_LOG: join(directory, 'postgres-commands.jsonl'), TRANSFER_LOG: join(directory, 'transfers.jsonl') };
  await applyMigrations(source, botRole);
  const snapshot = join(directory, 'snapshot.json');
  await writeFile(snapshot, JSON.stringify(fixture()));
  await runMigration({ snapshot, databaseUrl: urlFor(sourceDatabase) });
});

afterEach(async () => {
  if (bot) { await bot.end(); bot = undefined; }
  if (restored) { await restored.end(); restored = undefined; }
  if (source) await source.end();
  if (admin) {
    if (sourceDatabase) await admin.query(`DROP DATABASE IF EXISTS ${sourceDatabase} WITH (FORCE)`);
    if (targetDatabase) await admin.query(`DROP DATABASE IF EXISTS ${targetDatabase} WITH (FORCE)`);
    if (botRole) await admin.query(`DROP ROLE IF EXISTS ${botRole}`);
    await admin.end();
  }
  if (directory) await rm(directory, { recursive: true });
});

function runScript(name: string, args: string[] = []): string {
  return execFileSync('bash', [join(directory, 'scripts', name), ...args], { cwd: directory, env: environment, encoding: 'utf8', timeout: 20000 });
}

async function databaseContents(pool: Pool): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  // SQL text representation keeps numeric tokens exact instead of parsing them as JS numbers.
  for (const table of [...TABLES, 'schema_migrations', 'data_imports']) result[table] = (await pool.query<{ row: string }>(`SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(row => row.row);
  return result;
}

describe('deployed backup and restore with real PostgreSQL tools', () => {
  it('round-trips every field, schema and import marker and passes Bot readiness', async () => {
    const expected = await databaseContents(source);
    expect(runScript('pi-backup.sh')).toContain('backup: success');
    const manifests = (await readdir(join(directory, 'drive'))).filter(name => name.endsWith('.manifest.json'));
    expect(manifests).toHaveLength(1);
    const manifest = JSON.parse(await readFile(join(directory, 'drive', manifests[0]), 'utf8'));
    const dump = await readFile(join(directory, 'drive', `${manifest.generation}.dump`));
    expect(dump.subarray(0, 5).toString()).toBe('PGDMP');
    expect(createHash('sha256').update(dump).digest('hex')).toBe(manifest.sha256);
    expect(manifest.schema_version).toBe(1);
    expect(await readFile(join(directory, 'storage/backups', `${manifest.generation}.dump`))).toEqual(dump);
    const transfers = (await readFile(join(directory, 'transfers.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(transfers.filter(call => call[0] === 'copyto' && call[1].startsWith('bot-drive:'))).toHaveLength(2);
    expect(runScript('pi-restore.sh', [manifests[0], targetDatabase])).toContain(`restored to ${targetDatabase}`);
    restored = new Pool({ connectionString: urlFor(targetDatabase), max: 1 });
    expect(await databaseContents(restored)).toEqual(expected);
    const botUrl = new URL(urlFor(targetDatabase));
    botUrl.username = botRole;
    botUrl.password = 'issue36-local-only';
    bot = new Pool({ connectionString: botUrl.toString(), max: 1 });
    await expect(assertReady(bot)).resolves.toBeUndefined();
    const constraints = 'SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace=\'public\'::regnamespace ORDER BY conname';
    expect((await restored.query(constraints)).rows).toEqual((await source.query(constraints)).rows);
    const indexes = 'SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=\'public\' ORDER BY indexname';
    expect((await restored.query(indexes)).rows).toEqual((await source.query(indexes)).rows);
    for (const table of TABLES) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const permissions = await bot.query('SELECT has_table_privilege(current_user,$1,$2) AS permitted', [table, privilege]);
        expect(permissions.rows[0].permitted).toBe(privilege !== 'TRUNCATE');
      }
    }
    for (const table of ['schema_migrations', 'data_imports']) {
      const permissions = await bot.query('SELECT has_table_privilege(current_user,$1,\'SELECT\') AS readable, has_table_privilege(current_user,$1,\'INSERT,UPDATE,DELETE,TRUNCATE\') AS writable', [table]);
      expect(permissions.rows[0]).toEqual({ readable: true, writable: false });
    }
    const commands = await readFile(join(directory, 'postgres-commands.jsonl'), 'utf8');
    expect(commands).toContain('pg_dump -Fc');
    expect(commands).toContain('pg_restore --exit-on-error --single-transaction');
  });

  it('rejects a corrupt downloaded dump before creating a restore database', async () => {
    runScript('pi-backup.sh');
    const name = (await readdir(join(directory, 'drive'))).find(file => file.endsWith('.manifest.json'))!;
    const manifest = JSON.parse(await readFile(join(directory, 'drive', name), 'utf8'));
    await writeFile(join(directory, 'drive', `${manifest.generation}.dump`), 'corrupted');
    expect(() => runScript('pi-restore.sh', [name, targetDatabase])).toThrow();
    expect((await admin.query('SELECT datname FROM pg_database WHERE datname=$1', [targetDatabase])).rowCount).toBe(0);
    expect(await databaseContents(source)).toHaveProperty('data_imports');
  });
});
