import { afterEach, beforeEach, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let dir: string;
const digest = `sha256:${'a'.repeat(64)}`;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-ci-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'bin'));
  if (existsSync('scripts/pi-ci-deploy.sh')) copyFileSync('scripts/pi-ci-deploy.sh', join(dir, 'scripts/pi-ci-deploy.sh'));
  writeFileSync(join(dir, 'bin/sudo'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\nexit "${UPDATE_STATUS:-0}"\n', { mode: 0o755 });
  writeFileSync(join(dir, 'scripts/pi-update.sh'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\nexit "${VERIFY_STATUS:-0}"\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function run(command: string, update = '0', verify = '0'): { status: number | null; calls: string } {
  const calls = join(dir, 'calls');
  const result = spawnSync('/bin/bash', [join(dir, 'scripts/pi-ci-deploy.sh')], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, CALLS: calls,
      SSH_ORIGINAL_COMMAND: command, UPDATE_STATUS: update, VERIFY_STATUS: verify }
  });
  return { status: result.status, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
}
it('starts the systemd updater and verifies the exact published digest', () => {
  expect(run(`deploy ${digest}`)).toEqual({ status: 0,
    calls: `-n /usr/bin/systemctl start discord-bot-update.service\n--verify ghcr.io/yone-k/yone-discord-bot@${digest}\n` });
});
it.each(['', 'bash', 'deploy main', `deploy ${digest}; id`, `deploy ${digest}\nwhoami`])('rejects arbitrary SSH command %j before invoking the updater', command => {
  const result = run(command);
  expect(result.status).not.toBe(0);
  expect(result.calls).toBe('');
});
it('returns an update failure to CI without claiming verification', () => {
  const result = run(`deploy ${digest}`, '1');
  expect(result.status).not.toBe(0);
  expect(result.calls).not.toContain('--verify');
});
it('returns a verification failure to CI', () => {
  expect(run(`deploy ${digest}`, '0', '1').status).not.toBe(0);
});
it('does not start an update while CI deployments are disabled for maintenance', () => {
  mkdirSync(join(dir, '.deploy-state'));
  writeFileSync(join(dir, '.deploy-state/ci-disabled'), '');
  const result = run(`deploy ${digest}`);
  expect(result.status).not.toBe(0);
  expect(result.calls).toBe('');
});
