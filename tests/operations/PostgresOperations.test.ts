import { afterEach, beforeEach, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'db-ops-'));
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'storage/postgres/18/docker'), { recursive: true });
  writeFileSync(join(root, 'storage/postgres/18/docker/PG_VERSION'), '18\n');
  writeFileSync(join(root, 'storage/postgres/.discord-bot-disk'), 'test-uuid\n');
  cpSync('scripts', join(root, 'scripts'), { recursive: true });
  cpSync('deploy', join(root, 'deploy'), { recursive: true });
  writeFileSync(join(root, 'bin/docker-entrypoint.sh'), '#!/bin/sh\necho delegated\n', { mode: 0o755 });
  writeFileSync(join(root, 'bin/findmnt'), '#!/bin/sh\ncase "$*" in *UUID*) echo "${ACTUAL_UUID:-test-uuid}";; *FSTYPE*) echo "${ACTUAL_FS:-ext4}";; *OPTIONS*) echo "${ACTUAL_OPTIONS:-rw,relatime}";; esac\n', { mode: 0o755 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function run(file: string, args: string[] = [], env: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  return spawnSync('bash', [join(root, 'scripts', file), ...args], { encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, STORAGE_ROOT: `${root}/storage`, STORAGE_UUID: 'test-uuid', ...env } });
}
it('accepts the intended ext4 disk and existing PostgreSQL 18 directory', () => {
  expect(run('pi-db-preflight.sh').status).toBe(0);
});
it.each([{ ACTUAL_UUID: 'other' }, { ACTUAL_FS: 'ntfs3' }, { ACTUAL_OPTIONS: 'ro,relatime' }])('refuses a wrong or readonly mount: %j', env => {
  expect(run('pi-db-preflight.sh', [], env).status).not.toBe(0);
});
it('refuses an unmounted directory before creating files', () => {
  writeFileSync(join(root, 'bin/findmnt'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  expect(run('pi-db-preflight.sh').status).not.toBe(0);
});
it('refuses a mount whose write probe fails', () => {
  writeFileSync(join(root, 'bin/mktemp'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  expect(run('pi-db-preflight.sh').status).not.toBe(0);
});
it('accepts empty PGDATA only for explicit host initialization', () => {
  rmSync(join(root, 'storage/postgres/18/docker/PG_VERSION'));
  expect(run('pi-db-preflight.sh', ['--init']).status).toBe(0);
});
it.each(['missing-marker', 'empty-pgdata', 'wrong-version', 'valid'])('guards automatic Docker restart with %s', kind => {
  if (kind === 'missing-marker') rmSync(join(root, 'storage/postgres/.discord-bot-disk'));
  if (kind === 'empty-pgdata') rmSync(join(root, 'storage/postgres/18/docker/PG_VERSION'));
  if (kind === 'wrong-version') writeFileSync(join(root, 'storage/postgres/18/docker/PG_VERSION'), '17');
  const result = spawnSync('bash', [join(root, 'deploy/postgres-entrypoint.sh'), 'postgres'], { encoding: 'utf8',
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, STORAGE_UUID: 'test-uuid',
      POSTGRES_STORAGE_ROOT: `${root}/storage/postgres`, PGDATA: `${root}/storage/postgres/18/docker` } });
  expect(result.status === 0).toBe(kind === 'valid');
  expect(result.stdout.includes('delegated')).toBe(kind === 'valid');
});
it('refuses initialization over an existing cluster', () => {
  expect(run('pi-db-preflight.sh', ['--init']).status).not.toBe(0);
});
it('refuses an otherwise valid directory when the identity marker belongs to another disk', () => {
  writeFileSync(join(root, 'storage/postgres/.discord-bot-disk'), 'other');
  expect(run('pi-db-preflight.sh').status).not.toBe(0);
});
it('keeps credentials out of the normal Bot service', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  const bot = compose.split('  bot:')[1].split('\n  db:')[0];
  expect(bot).not.toContain('.env.db-admin');
  expect(bot).not.toContain('.env.migration');
  expect(compose).toContain('create_host_path: false');
});
