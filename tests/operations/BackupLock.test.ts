import { afterEach, beforeEach, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'backup-lock-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  copyFileSync('scripts/pi-backup.sh', join(root, 'scripts/pi-backup.sh'));
  writeFileSync(join(root, '.env.storage'), 'STORAGE_UUID=synthetic\n');
  writeFileSync(join(root, '.env.backup'), 'RCLONE_REMOTE=synthetic:\n');
  writeFileSync(join(root, 'scripts/pi-db-preflight.sh'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(root, 'bin/flock'), '#!/bin/sh\nexit "$BUSY"\n', { mode: 0o755 });
  writeFileSync(join(root, 'bin/python3'), '#!/bin/sh\ntouch backup-started\n', { mode: 0o755 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it.each(['0', '1'])('takes the deployment lock before capturing the shared digest (busy=%s)', busy => {
  const result = spawnSync('bash', [join(root, 'scripts/pi-backup.sh')], {
    encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, BUSY: busy }
  });
  expect(result.status === 0).toBe(busy === '0');
  expect(existsSync(join(root, 'backup-started'))).toBe(busy === '0');
});
