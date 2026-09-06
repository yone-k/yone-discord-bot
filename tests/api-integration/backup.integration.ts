import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const tables = ['list_channels', 'list_items', 'inventory_channels', 'inventory_items', 'remind_channels', 'remind_tasks', 'remind_task_inventory_items', 'schema_migrations', 'data_imports'];
const shellQuote = (value: string): string => `'${value.replace(/'/g, '\'\\\'\'')}'`;

it('backs up and restores all fields, constraints, indexes and limited-role grants with deployed scripts', () => {
  const raw = process.env.TEST_DATABASE_URL;
  const container = process.env.TEST_DB_CONTAINER_ID;
  const limitedUrl = process.env.DATABASE_URL;
  const runId = process.env.API_INTEGRATION_RUN_ID;
  if (!raw || !container || !limitedUrl || !process.env.API_INTEGRATION_CLUSTER_ID || !runId || !/^[0-9a-f]{24}$/.test(runId)) throw new Error('Use the guarded API integration runner');
  const source = new URL(raw);
  const database = source.pathname.slice(1);
  if (!/^[a-z][a-z0-9_]*_http$/.test(database)) throw new Error('Dedicated HTTP database required');
  const target = `${database.slice(0, 25)}_restore_${runId}`;
  const role = new URL(limitedUrl).username;
  const image = `ghcr.io/yone-k/yone-discord-bot@sha256:${'a'.repeat(64)}`;
  if (!/^[a-z][a-z0-9_]*$/.test(role)) throw new Error('Invalid integration role');
  const docker = execFileSync('which', ['docker'], { encoding: 'utf8' }).trim();
  const sql = (query: string, name = database): string => execFileSync(docker, ['exec', '-i', '-e', 'PGPASSWORD', container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', decodeURIComponent(source.username), '-d', name], {
    input: query, encoding: 'utf8', timeout: 10000, env: { ...process.env, PGPASSWORD: decodeURIComponent(source.password) }
  }).trim();
  if (sql('SELECT system_identifier::text FROM pg_control_system()') !== process.env.API_INTEGRATION_CLUSTER_ID) throw new Error('Cluster identity changed');
  const directory = mkdtempSync(join(tmpdir(), 'go-core-backup-'));
  const executable = (name: string, content: string): void => {
    const path = join(directory, 'bin', name); writeFileSync(path, content); chmodSync(path, 0o700);
  };
  try {
    for (const path of ['bin', 'scripts', 'deploy', '.deploy-state', 'storage/postgres', 'drive']) mkdirSync(join(directory, path), { recursive: true });
    for (const path of ['scripts/pi-backup.sh', 'scripts/pi-restore.sh', 'scripts/pi-db-preflight.sh', 'deploy/postgres-backup.py']) copyFileSync(resolve(path), join(directory, path));
    writeFileSync(join(directory, '.env.storage'), `STORAGE_UUID=synthetic-test-uuid\nSTORAGE_ROOT=${shellQuote(join(directory, 'storage'))}\n`);
    writeFileSync(join(directory, '.env.backup'), 'RCLONE_REMOTE=bot-drive:\n');
    writeFileSync(join(directory, 'storage/postgres/.discord-bot-disk'), 'synthetic-test-uuid\n');
    writeFileSync(join(directory, '.deploy-state/ci-disabled'), '');
    writeFileSync(join(directory, '.deploy-state/state'), `blocked=1\ncurrent=${image}\n`);
    executable('findmnt', '#!/bin/bash\ncase "${!#}" in UUID) echo synthetic-test-uuid;; FSTYPE) echo ext4;; OPTIONS) echo rw;; *) exit 1;; esac\n');
    executable('systemctl', '#!/bin/bash\nexit 3\n');
    executable('flock', '#!/bin/bash\nexit 0\n');
    executable('docker', `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if not args or args.pop(0) != 'compose': raise SystemExit('Only Compose expected')
if args[:1] == ['-p']: args = args[2:]
if args == ['ps', '--status', 'running', '-q', 'bot', 'api']: raise SystemExit(0)
if args[:3] != ['exec', '-T', 'db']: raise SystemExit('Unexpected Compose operation')
with open(os.environ['COMMAND_LOG'], 'a') as log: log.write(json.dumps(args) + '\\n')
actual = [os.environ['REAL_DOCKER'], 'exec', '-i', '-e', 'POSTGRES_DB=' + os.environ['SOURCE_DATABASE'], '-e', 'POSTGRES_USER=' + os.environ['DATABASE_USER'], os.environ['TEST_DB_CONTAINER_ID']] + args[3:]
os.execv(actual[0], actual)
`);
    executable('rclone', `#!/usr/bin/env python3
import os, pathlib, shutil, sys
args = sys.argv[1:]
def path(value):
    if value.startswith('bot-drive:'):
        name = value[len('bot-drive:'):]
        if pathlib.Path(name).name != name: raise ValueError('Invalid object')
        return pathlib.Path(os.environ['MOCK_DRIVE']) / name
    return pathlib.Path(value)
if args[0] == 'copyto': shutil.copyfile(path(args[1]), path(args[2]))
elif args[0] == 'deletefile': path(args[1]).unlink(missing_ok=True)
else: raise SystemExit('Unexpected transfer')
`);
    // Keep real PostgreSQL tools, shell guards and Python orchestration. Only Pi
    // mount/service boundaries and remote Drive objects are supplied locally.
    const environment = { ...process.env, BOT_IMAGE: '', PATH: `${join(directory, 'bin')}:${process.env.PATH}`, REAL_DOCKER: docker, SOURCE_DATABASE: database, DATABASE_USER: decodeURIComponent(source.username),
      MOCK_DRIVE: join(directory, 'drive'), COMMAND_LOG: join(directory, 'commands.jsonl') };
    const run = (script: string, args: string[] = []): string => execFileSync('bash', [join(directory, 'scripts', script), ...args], { cwd: directory, env: environment, encoding: 'utf8', timeout: 20000 });
    sql(`INSERT INTO list_channels(channel_id,list_title,default_category) VALUES('9901','買物','食品');
      INSERT INTO list_items(channel_id,name,category,until,is_completed,position) VALUES('9901','保存品','長期','2026-12-31',true,0);
      INSERT INTO inventory_channels(channel_id,list_title,default_category) VALUES('9902','在庫','日用品');
      INSERT INTO inventory_items(channel_id,id,name,stock,position) VALUES('9902','legacy-stock','洗剤',9007199254740993.0000000000000000003,0);
      INSERT INTO remind_channels(channel_id,list_title,linked_inventory_channel_id) VALUES('9903','掃除','9902');
      INSERT INTO remind_tasks(channel_id,id,message_id,title,description,interval_days,time_of_day,remind_before_minutes,start_at,next_due_at,created_at,updated_at,position)
        VALUES('9903','legacy-task','990399','清掃','全項目の復元',7,'09:15',60,'2026-01-01T00:00:00.123Z','2026-01-08T00:15:00.456Z','2026-01-01T00:00:00.123Z','2026-01-01T00:00:00.123Z',0);
      INSERT INTO remind_task_inventory_items(task_channel_id,task_id,inventory_channel_id,inventory_id,consume,position)
        VALUES('9903','legacy-task','9902','legacy-stock',0.0000000000000000002,0);`);
    const contents = (name: string): Record<string, string> => Object.fromEntries(tables.map(table => [table, sql(`SELECT to_jsonb(t)::text FROM ${table} t ORDER BY to_jsonb(t)::text`, name)]));
    const expected = contents(database);
    expect(run('pi-backup.sh')).toContain('backup: success');
    const manifests = readdirSync(join(directory, 'drive')).filter(name => name.endsWith('.manifest.json'));
    expect(manifests).toHaveLength(1);
    const manifest = JSON.parse(readFileSync(join(directory, 'drive', manifests[0]), 'utf8'));
    const dump = readFileSync(join(directory, 'drive', `${manifest.generation}.dump`));
    expect(dump.subarray(0, 5).toString()).toBe('PGDMP');
    expect(createHash('sha256').update(dump).digest('hex')).toBe(manifest.sha256);
    expect(manifest.schema_version).toBe(2);
    expect(manifest.bot_image).toBe(image);
    expect(readFileSync(join(directory, 'storage/backups', `${manifest.generation}.dump`))).toEqual(dump);
    const restoreOutput = run('pi-restore.sh', [manifests[0], target]);
    expect(restoreOutput).toContain(`restored to ${target}`);
    expect(restoreOutput).toContain(`corresponding-image=${image}`);
    expect(contents(target)).toEqual(expected);
    for (const query of [
      'SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace=\'public\'::regnamespace ORDER BY conname',
      'SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=\'public\' ORDER BY indexname',
      'SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,numeric_precision,numeric_scale,datetime_precision,collation_name FROM information_schema.columns WHERE table_schema=\'public\' ORDER BY table_name,ordinal_position'
    ]) expect(sql(query, target)).toBe(sql(query));
    for (const table of tables) {
      const readOnly = ['schema_migrations', 'data_imports'].includes(table);
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        expect(sql(`SELECT has_table_privilege('${role}','${table}','${privilege}')`, target)).toBe(privilege === 'SELECT' || (!readOnly && privilege !== 'TRUNCATE') ? 't' : 'f');
      }
    }
    const commands = readFileSync(join(directory, 'commands.jsonl'), 'utf8');
    expect(commands).toContain('pg_dump -Fc');
    expect(commands).toContain('pg_restore --exit-on-error --single-transaction');
    sql(`DROP DATABASE ${target}`, 'postgres');
    writeFileSync(join(directory, 'drive', `${manifest.generation}.dump`), 'corrupted');
    expect(() => run('pi-restore.sh', [manifests[0], target])).toThrow();
    expect(sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`, 'postgres')).toBe('0');
    expect(contents(database)).toEqual(expected);

    // A matching checksum admits the download, but pg_restore must still reject
    // invalid archive contents after createdb. Keep that empty DB for diagnosis.
    const broken = readFileSync(join(directory, 'drive', `${manifest.generation}.dump`));
    writeFileSync(join(directory, 'drive', manifests[0]), JSON.stringify({ ...manifest, sha256: createHash('sha256').update(broken).digest('hex') }));
    expect(() => run('pi-restore.sh', [manifests[0], target])).toThrow();
    expect(sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`, 'postgres')).toBe('1');
    expect(sql('SELECT count(*) FROM pg_tables WHERE schemaname=\'public\'', target)).toBe('0');
    expect(contents(database)).toEqual(expected);
  } finally {
    try {
      sql(`DROP DATABASE IF EXISTS ${target}`, 'postgres');
      sql(`DELETE FROM remind_task_inventory_items WHERE task_channel_id='9903';
        DELETE FROM remind_tasks WHERE channel_id='9903'; DELETE FROM remind_channels WHERE channel_id='9903';
        DELETE FROM inventory_items WHERE channel_id='9902'; DELETE FROM inventory_channels WHERE channel_id='9902';
        DELETE FROM list_items WHERE channel_id='9901'; DELETE FROM list_channels WHERE channel_id='9901';`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}, 90000);
