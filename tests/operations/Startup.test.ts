import { afterEach, beforeEach, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'db-start-'));
  cpSync('scripts', join(root, 'scripts'), { recursive: true });
  cpSync('deploy', join(root, 'deploy'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'storage/postgres'), { recursive: true });
  mkdirSync(join(root, '.deploy-state'));
  writeFileSync(join(root, '.deploy-state/ci-disabled'), '');
  writeFileSync(join(root, '.env.storage'), `STORAGE_ROOT='${root}/storage'\nSTORAGE_UUID=synthetic\n`);
  writeFileSync(join(root, 'scripts/pi-db-preflight.sh'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(root, 'bin/flock'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(root, 'bin/docker'), `#!/bin/sh
echo "$*" >> "$CALLS"
case "$*" in
  *'config --format json'*) printf '%s\\n' '{"services":{"bot":{"environment":{"DISCORD_BOT_TOKEN":"same","CORE_API_TOKEN":"same"}},"api":{"environment":{"DISCORD_BOT_TOKEN":"same","CORE_API_TOKEN":"same","DISCORD_OUTPUT_ENABLED":"false"}}}}' ;;
  *'ps --status running'*) [ "$RUNNING" = 0 ] || echo existing ;;
  *'ops --check'*) exit "$SCHEMA_FAIL" ;;
  *'up -d --no-deps --no-build'*) [ -f .deploy-state/schema-v3-confirmed ] || exit 9; exit "$START_FAIL" ;;
esac
`, { mode: 0o755 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function run(script: string, env: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  return spawnSync('bash', [join(root, 'scripts', script)], { encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, CALLS: `${root}/calls`, RUNNING: '0', SCHEMA_FAIL: '0', START_FAIL: '0',
      BOT_IMAGE: `ghcr.io/yone-k/yone-discord-bot@sha256:${'a'.repeat(64)}`, ...env } });
}
it('removes the initialization service before starting the guarded database', () => {
  expect(run('pi-db-init.sh').status).toBe(0);
  const calls = readFileSync(join(root, 'calls'), 'utf8');
  expect(calls.indexOf('rm -f db-init')).toBeLessThan(calls.indexOf('up -d --no-deps db\n'));
  expect(existsSync(join(root, 'storage/postgres/.initialization-approved'))).toBe(false);
});
it('refuses initialization while a database container is running', () => {
  expect(run('pi-db-init.sh', { RUNNING: '1' }).status).not.toBe(0);
  expect(readFileSync(join(root, 'calls'), 'utf8')).not.toContain('up -d');
});
it('does not start either service if schema validation fails', () => {
  expect(run('pi-start.sh', { SCHEMA_FAIL: '1' }).status).not.toBe(0);
  expect(existsSync(join(root, '.deploy-state/schema-v3-confirmed'))).toBe(false);
});
it('records confirmed v3 even if Compose startup fails', () => {
  expect(run('pi-start.sh', { START_FAIL: '1' }).status).not.toBe(0);
  expect(existsSync(join(root, '.deploy-state/schema-v3-confirmed'))).toBe(true);
});
it('requires both services stopped before manual startup', () => {
  expect(run('pi-start.sh', { RUNNING: '1' }).status).not.toBe(0);
  expect(existsSync(join(root, '.deploy-state/schema-v3-confirmed'))).toBe(false);
});

it('starts and waits for API before starting and waiting for Bot', () => {
  expect(run('pi-start.sh').status).toBe(0);
  const calls = readFileSync(join(root, 'calls'), 'utf8');
  const starts = calls.split('\n').filter(line => line.includes('up -d --no-deps'));
  expect(starts).toHaveLength(2);
  expect(starts[0]).toMatch(/--wait --wait-timeout 300 api$/);
  expect(starts[1]).toMatch(/--wait --wait-timeout 300 bot$/);
});
