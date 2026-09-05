import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const repo = 'ghcr.io/yone-k/yone-discord-bot';
const old = `${repo}@sha256:${'a'.repeat(64)}`;
const next = `${repo}@sha256:${'b'.repeat(64)}`;
let dir: string;
let bin: string;
type Fixture = {
  current: string; target: string; failed: string[];
  pullFail?: boolean; configFail?: boolean; stopFail?: boolean; busy?: boolean; missing?: boolean;
  starting?: string[]; platform?: string; upFail?: string[]; incompatible?: string[];
};
let fixture: Fixture;

const dockerStub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.FIXTURE_DIR;
const f = path.join(root, 'docker.json');
const s = JSON.parse(fs.readFileSync(f, 'utf8'));
let a = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls'), JSON.stringify(a) + '\\n');
function finish(code=0, output='') { if(output) console.log(output); process.exit(code); }
if(a[0] === 'pull') finish(s.pullFail ? 1 : 0);
if(a[0] === 'image' && a[1] === 'inspect') {
  if(a.includes('{{range .RepoDigests}}{{println .}}{{end}}')) finish(0, s.target);
  if(a.includes('{{.Os}}/{{.Architecture}}')) finish(0, s.platform || 'linux/arm64');
  finish(0, a[a.length-1]);
}
if(a[0] === 'compose') {
  if(a.includes('run')) finish(s.incompatible?.includes(process.env.BOT_IMAGE) ? 1 : 0);
  if(a.includes('config')) finish(s.configFail ? 1 : 0);
  if(a.includes('ps')) finish(0, s.missing ? '' : 'container');
  if(a.includes('stop')) { if(s.stopFail) finish(1); s.stopped=true; fs.writeFileSync(f,JSON.stringify(s)); finish(); }
  if(a.includes('up')) { if(s.upFail?.includes(process.env.BOT_IMAGE)) finish(1); s.current=process.env.BOT_IMAGE; s.stopped=false; fs.writeFileSync(f,JSON.stringify(s)); finish(); }
}
if(a[0] === 'inspect') {
  const state=s.stopped?'exited':'running';
  const health=s.starting?.includes(s.current)?'starting':s.failed.includes(s.current)?'unhealthy':'healthy';
  finish(0, s.current+'|'+state+'|'+health);
}
finish(2);
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-update-'));
  bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, 'scripts'));
  if (existsSync('scripts/pi-update.sh')) copyFileSync('scripts/pi-update.sh', join(dir, 'scripts/pi-update.sh'));
  writeFileSync(join(dir, 'scripts/pi-db-preflight.sh'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(dir, 'docker-compose.yml'), 'name: discord-bot\n');
  writeFileSync(join(dir, '.env'), 'DISCORD_BOT_TOKEN=not-a-real-token\n');
  writeFileSync(join(bin, 'docker'), dockerStub, { mode: 0o755 });
  writeFileSync(join(bin, 'flock'), `#!${process.execPath}\nconst fs=require('node:fs');process.exit(JSON.parse(fs.readFileSync(process.env.FIXTURE_DIR+'/docker.json','utf8')).busy?1:0);\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'date'), `#!${process.execPath}\nconst fs=require('node:fs'),f=process.env.FIXTURE_DIR+'/time';let n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+60));console.log(n);\n`, { mode: 0o755 });
  fixture = { current: old, target: next, failed: [] };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(...args: string[]): ReturnType<typeof spawnSync> {
  writeFileSync(join(dir, 'docker.json'), JSON.stringify(fixture));
  const result = spawnSync('/bin/bash', [join(dir, 'scripts/pi-update.sh'), ...args], {
    cwd: dir, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_DIR: dir }
  });
  fixture = JSON.parse(readFileSync(join(dir, 'docker.json'), 'utf8'));
  return result;
}
function calls(): string[][] {
  const p = join(dir, 'calls');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}
function state(): string { return readFileSync(join(dir, '.deploy-state/state'), 'utf8'); }
function initialize(): void { expect(run('--initialize', old).status).toBe(0); }
function clearCalls(): void { writeFileSync(join(dir, 'calls'), ''); }
function upCalls(): string[][] { return calls().filter(c => c.includes('up')); }

describe('Pi update lifecycle', () => {
  it('refuses a schema-incompatible candidate before replacing the running Bot', () => {
    initialize(); fixture.incompatible = [next]; clearCalls();
    expect(run().status).not.toBe(0);
    expect(upCalls()).toHaveLength(0);
    expect(fixture.current).toBe(old);
  });
  it('never rolls back to a Sheets image without the DB schema checker', () => {
    initialize(); fixture.incompatible = [old]; fixture.failed = [next]; clearCalls();
    expect(run().status).not.toBe(0);
    expect(upCalls()).toHaveLength(0);
  });
  it('rejects manual recovery to an incompatible or Sheets image', () => {
    initialize(); fixture.incompatible = [next]; clearCalls();
    expect(run('--recover', next).status).not.toBe(0);
    expect(upCalls()).toHaveLength(0);
  });
  it('reports contention as failure when establishing a maintenance block', () => {
    initialize(); fixture.busy = true;
    expect(run('--block').status).not.toBe(0);
  });
  it('verifies the deployed digest and health without pulling or recreating', () => {
    initialize(); clearCalls();
    expect(run('--verify', old).status).toBe(0);
    expect(calls().some(c => c[0] === 'pull' || c.includes('up'))).toBe(false);
  });
  it.each(['unhealthy', 'wrong-digest', 'blocked', 'busy', 'uninitialized'])('fails CI verification for %s', reason => {
    if (reason !== 'uninitialized') initialize();
    if (reason === 'unhealthy') fixture.failed = [old];
    if (reason === 'blocked') writeFileSync(join(dir, '.deploy-state/state'), state().replace('blocked=0', 'blocked=1'));
    if (reason === 'busy') fixture.busy = true;
    expect(run('--verify', reason === 'wrong-digest' ? next : old).status).not.toBe(0);
  });
  it('does not start or pull a bot before initial acceptance', () => {
    expect(run().status).toBe(0);
    expect(calls()).toEqual([]);
  });
  it('records the existing healthy digest without recreating it', () => {
    initialize();
    expect(state()).toContain(`current=${old}`);
    expect(upCalls()).toHaveLength(0);
  });
  it('rejects tags and mismatched initial digests', () => {
    expect(run('--initialize', `${repo}:main`).status).not.toBe(0);
    expect(run('--initialize', next).status).not.toBe(0);
    expect(upCalls()).toHaveLength(0);
  });
  it('keeps the same digest running without recreation', () => {
    initialize(); fixture.target = old; clearCalls();
    expect(run().status).toBe(0);
    expect(upCalls()).toHaveLength(0);
  });
  it('keeps the running bot when pull fails', () => {
    initialize(); fixture.pullFail = true; clearCalls();
    expect(run().status).not.toBe(0);
    expect(upCalls()).toHaveLength(0);
    expect(state()).toContain(`current=${old}`);
  });
  it('validates configuration before replacing the running bot', () => {
    initialize(); fixture.configFail = true; clearCalls();
    expect(run().status).not.toBe(0);
    expect(upCalls()).toHaveLength(0);
  });
  it('advances state only after a successful update and keeps a rollback digest', () => {
    initialize();
    expect(run().status).toBe(0);
    expect(fixture.current).toBe(next);
    expect(state()).toContain(`current=${next}`);
    expect(state()).toContain(`previous=${old}`);
  });
  it('rolls back a failed version and does not retry it on the next tick', () => {
    initialize(); fixture.failed = [next];
    expect(run().status).not.toBe(0);
    expect(fixture.current).toBe(old);
    expect(state()).toContain(`rejected=${next}`);
    expect(state()).toContain('blocked=0');
    clearCalls();
    expect(run().status).toBe(0);
    expect(upCalls()).toHaveLength(0);
  });
  it('persists a block if rollback also fails', () => {
    initialize(); fixture.failed = [old, next];
    expect(run().status).not.toBe(0);
    expect(state()).toContain('blocked=1');
    clearCalls();
    expect(run().status).not.toBe(0);
    expect(calls()).toEqual([]);
  });
  it('blocks instead of starting rollback if the failed container cannot stop', () => {
    initialize(); fixture.failed = [next]; fixture.stopFail = true;
    expect(run().status).not.toBe(0);
    expect(state()).toContain('blocked=1');
    expect(upCalls()).toHaveLength(1);
  });
  it('does not restart an unchanged unhealthy bot', () => {
    initialize(); fixture.target = old; fixture.failed = [old]; clearCalls();
    expect(run().status).toBe(0);
    expect(upCalls()).toHaveLength(0);
  });
  it('does not enter Docker when another updater owns the lock', () => {
    initialize(); fixture.busy = true; clearCalls();
    expect(run().status).toBe(0);
    expect(calls()).toEqual([]);
  });
  it('reports lock tool failures instead of treating them as contention', () => {
    writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit 69\n', { mode: 0o755 });
    expect(run().status).not.toBe(0);
    expect(calls()).toEqual([]);
  });
  it.skipIf(process.platform !== 'linux')('respects a real Linux flock held by another process', async () => {
    initialize(); clearCalls();
    rmSync(join(bin, 'flock'));
    const holder = spawn('flock', [join(dir, '.deploy-state/lock'), 'sh', '-c', 'echo locked; read release'], { stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      await once(holder.stdout, 'data');
      expect(run().status).toBe(0);
      expect(calls()).toEqual([]);
    } finally {
      const done = once(holder, 'exit');
      holder.stdin.end('release\n');
      await done;
    }
    expect(run().status).toBe(0);
    expect(fixture.current).toBe(next);
  });
  it('blocks an interrupted transaction instead of guessing a version', () => {
    initialize();
    writeFileSync(join(dir, '.deploy-state/state'), state().replace('pending=0', 'pending=1'));
    clearCalls();
    expect(run().status).not.toBe(0);
    expect(state()).toContain('blocked=1');
    expect(upCalls()).toHaveLength(0);
  });
  it('rejects state as data without executing it', () => {
    initialize();
    writeFileSync(join(dir, '.deploy-state/state'), `current=$(touch ${join(dir, 'executed')})\n`);
    expect(run().status).not.toBe(0);
    expect(existsSync(join(dir, 'executed'))).toBe(false);
  });
  it.each(['missing', 'mismatched'])('blocks a %s running container', kind => {
    initialize();
    if (kind === 'missing') fixture.missing = true; else fixture.current = next;
    clearCalls();
    expect(run().status).not.toBe(0);
    expect(state()).toContain('blocked=1');
    expect(upCalls()).toHaveLength(0);
  });
  it('rolls back a candidate that remains starting beyond the health deadline', () => {
    initialize(); fixture.starting = [next];
    expect(run().status).toBe(1);
    expect(fixture.current).toBe(old);
    expect(state()).toContain(`rejected=${next}`);
    expect(state()).toContain('pending=0');
  });
  it('restores the old bot if Compose cannot start the candidate', () => {
    initialize(); fixture.upFail = [next];
    expect(run().status).toBe(1);
    expect(fixture.current).toBe(old);
    expect(state()).toContain('blocked=0');
    expect(upCalls()).toHaveLength(2);
  });
  it('requires explicit retry before applying a previously rejected version', () => {
    initialize(); fixture.failed = [next];
    expect(run().status).toBe(1);
    fixture.failed = [];
    expect(run('--retry', next).status).toBe(0);
    expect(fixture.current).toBe(next);
    expect(state()).toContain('rejected=\n');
  });
  it.each(['platform', 'digest'])('rejects invalid candidate %s before replacement', kind => {
    initialize(); clearCalls();
    if (kind === 'platform') fixture.platform = 'linux/amd64'; else fixture.target = 'invalid';
    expect(run().status).toBe(1);
    expect(upCalls()).toHaveLength(0);
    expect(state()).toContain(`current=${old}`);
  });
  it('recovers to an explicitly selected healthy digest and clears the block', () => {
    initialize();
    writeFileSync(join(dir, '.deploy-state/state'), state().replace('blocked=0', 'blocked=1'));
    expect(run('--recover', old).status).toBe(0);
    expect(state()).toContain('blocked=0');
    expect(state()).toContain('pending=0');
  });
});
