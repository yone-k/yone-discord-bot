import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

let dir: string;
const sha = 'a'.repeat(40);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'publish-image-'));
  writeFileSync(join(dir, 'git'), '#!/bin/sh\n[ "$LOOKUP_FAIL" != 1 ] || exit 1\nprintf "%s\\trefs/heads/main\\n" "$REMOTE_SHA"\n', { mode: 0o755 });
  writeFileSync(join(dir, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n', { mode: 0o755 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(remote: string, ref = 'refs/heads/main', fail = '0'): { status: number | null; calls: string } {
  const callsFile = join(dir, 'calls');
  const result = spawnSync('/bin/bash', [resolve('scripts/publish-image.sh')], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: callsFile,
      IMAGE: 'ghcr.io/yone-k/yone-discord-bot', GITHUB_SHA: sha, GITHUB_REF: ref, REMOTE_SHA: remote, LOOKUP_FAIL: fail }
  });
  return { status: result.status, calls: existsSync(callsFile) ? readFileSync(callsFile, 'utf8') : '' };
}

it('publishes the already-built image under SHA and main', () => {
  const result = run(sha);
  expect(result.status).toBe(0);
  expect(result.calls.trim().split('\n')).toEqual([
    `push ghcr.io/yone-k/yone-discord-bot:${sha}`,
    `tag ghcr.io/yone-k/yone-discord-bot:${sha} ghcr.io/yone-k/yone-discord-bot:main`,
    'push ghcr.io/yone-k/yone-discord-bot:main'
  ]);
});
it('does not publish stale main runs', () => {
  expect(run('b'.repeat(40))).toEqual({ status: 0, calls: '' });
});
it('does not publish dispatches on other branches', () => {
  expect(run(sha, 'refs/heads/feature')).toEqual({ status: 0, calls: '' });
});
it('fails closed when main cannot be resolved', () => {
  const result = run(sha, 'refs/heads/main', '1');
  expect(result.status).not.toBe(0);
  expect(result.calls).toBe('');
});
it('fails closed when the main reference is missing', () => {
  const result = run('');
  expect(result.status).not.toBe(0);
  expect(result.calls).toBe('');
});
