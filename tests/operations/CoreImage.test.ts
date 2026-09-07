import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'core-image-'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin/docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  'image inspect --format {{.Id}}'*|'inspect --format {{.Image}}'*) echo synthetic-image-id ;;
  'image inspect'*) echo linux/arm64 ;;
  *'--entrypoint /app/bin/db-migrate'*) exit "$MIGRATION_FAIL" ;;
  *'pg_dump'*) printf 'synthetic dump' ;;
  *'SELECT checksum'*) printf '%064d\\n' 0 ;;
  *'SELECT count(*) FROM output_dispatches'*) echo 1 ;;
  *'SELECT message_id FROM list_channels'*) echo 300 ;;
esac
`, { mode: 0o755 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it.each(['0', '1'])('checks a disposable API and restores its database, then cleans its resources (migration failure=%s)', failure => {
  const result = spawnSync('bash', ['scripts/check-core-image.sh', 'synthetic:local'], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, CALLS: join(root, 'calls'), MIGRATION_FAIL: failure }
  });
  expect(result.status === 0, result.stderr).toBe(failure === '0');
  expect(existsSync(join(root, 'calls'))).toBe(true);
  const calls = readFileSync(join(root, 'calls'), 'utf8');
  expect(calls).toContain('network create');
  expect(calls).toContain('network rm');
  expect(calls).toContain('rm -f');
  expect(calls).not.toContain('publish');
  if (failure === '0') {
    expect(calls).toContain('--entrypoint /app/bin/core-api');
    expect(calls).toContain('--network-alias discord.com');
    expect(calls).toContain('DISCORD_OUTPUT_ENABLED=true');
    expect(calls).toContain('/app/bin/outputctl list');
    expect(calls).toContain('NODE_EXTRA_CA_CERTS=/test/cert.pem');
    expect(calls).toContain('pg_restore');
    expect(calls).toContain('401 /v1/notifications/poll');
    expect(calls).toContain('503 /health');
    expect(calls).toContain('discord_bot_restored');
    expect(calls).toContain('node --require /app/discord-smoke.cjs dist/index.js');
    expect(calls).toContain('503 bot-health');
  }
});
