import { afterEach, beforeEach, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let dir: string;
const content = ['DISCORD_BOT_TOKEN="dummy"', 'CLIENT_ID="123"', 'GOOGLE_SERVICE_ACCOUNT_EMAIL="a@example.invalid"',
  'GOOGLE_SHEETS_SPREADSHEET_ID="dummy"', 'GOOGLE_PRIVATE_KEY="dummy"', 'NODE_ENV="production"'].join('\n') + '\n';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'install-pi-env-'));
  mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'bin'));
  try { copyFileSync('scripts/install-pi-env.sh', join(dir, 'scripts/install-pi-env.sh')); } catch { /* RED: missing script */ }
  writeFileSync(join(dir, '.env'), 'existing');
  writeFileSync(join(dir, 'bin/docker'), '#!/bin/sh\nexit "${CONFIG_FAIL:-0}"\n', { mode: 0o755 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function run(input: string, fail = '0'): ReturnType<typeof spawnSync> {
  return spawnSync('/bin/bash', [join(dir, 'scripts/install-pi-env.sh')], {
    input, encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, CONFIG_FAIL: fail,
      BOT_IMAGE: `ghcr.io/yone-k/yone-discord-bot@sha256:${'a'.repeat(64)}` }
  });
}
it('atomically installs a complete validated configuration with mode 600', () => {
  expect(run(content).status).toBe(0);
  expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(content);
  expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
});
it.each(['', content.slice(0, -2)])('preserves existing configuration on truncated transfer', input => {
  expect(run(input).status).not.toBe(0);
  expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('existing');
});
it('preserves existing configuration if Compose validation fails', () => {
  const result = run(content, '1');
  expect(result.status).not.toBe(0);
  expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('existing');
  expect(`${result.stdout}${result.stderr}`).not.toContain('dummy');
});
