import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const target = 'http://127.0.0.1:8080';
let dir: string;

const tailscaleStub = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_DIR + '/calls', JSON.stringify(args) + '\\n');
if (args[0] === 'serve' && args[1] === 'status') {
  if (process.env.STATUS_FAIL === '1') process.exit(1);
  console.log(process.env.STATUS_JSON || '{}');
  process.exit(0);
}
process.exit(process.env.SERVE_FAIL === '1' ? 1 : 0);
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tailscale-serve-'));
  mkdirSync(join(dir, 'bin'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string> = {}, withTailscale = true): ReturnType<typeof spawnSync> {
  if (withTailscale) writeFileSync(join(dir, 'bin/tailscale'), tailscaleStub, { mode: 0o755 });
  const path = withTailscale ? `${join(dir, 'bin')}:/usr/bin:/bin` : '/usr/bin:/bin';
  return spawnSync('/bin/bash', ['scripts/pi-tailscale-serve.sh'], {
    encoding: 'utf8', timeout: 10000,
    env: { PATH: path, FIXTURE_DIR: dir, ...env }
  });
}
function calls(): string[][] {
  const p = join(dir, 'calls');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}
function serveStatus(proxy: string, port = '443'): string {
  return JSON.stringify({ TCP: { [port]: { HTTPS: true } }, Web: { [`pi.example.ts.net:${port}`]: { Handlers: { '/': { Proxy: proxy } } } } });
}

describe('tailscale serve setup', () => {
  it('leaves an existing HTTPS proxy to the Core API unchanged', () => {
    const result = run({ STATUS_JSON: serveStatus(target) });
    expect(result.status).toBe(0);
    expect(calls()).toEqual([['serve', 'status', '--json']]);
  });

  it.each([
    ['nothing is served', '{}'],
    ['another backend is served', serveStatus('http://127.0.0.1:3000')],
    ['another port is served', serveStatus(target, '8443')]
  ])('publishes the Core API over HTTPS when %s', (_name, status) => {
    const result = run({ STATUS_JSON: status });
    expect(result.status).toBe(0);
    expect(calls().at(-1)).toEqual(['serve', '--bg', '--https=443', target]);
  });

  it.each([
    ['the status cannot be read', { STATUS_FAIL: '1' }],
    ['serve fails', { STATUS_JSON: '{}', SERVE_FAIL: '1' }]
  ])('warns and succeeds when %s', (_name, env) => {
    const result = run(env);
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/^warn: /m);
  });

  it('warns and succeeds without the tailscale command', () => {
    const result = run({}, false);
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/^warn: /m);
  });
});
