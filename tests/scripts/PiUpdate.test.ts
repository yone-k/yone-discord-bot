import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const repo = 'ghcr.io/yone-k/yone-discord-bot';
const old = `${repo}@sha256:${'a'.repeat(64)}`;
const next = `${repo}@sha256:${'b'.repeat(64)}`;
const commandTimeoutMs = 15000;
// A scenario invokes at most three bounded lifecycle commands (for example,
// initialize, failed update, retry). Include 5s for fixture and assertion work.
const scenarioTimeoutMs = commandTimeoutMs * 3 + 5000;
let dir: string;
let bin: string;
type Fixture = {
  current: string; target: string; failed: string[];
  pullFail?: boolean; configFail?: boolean; stopFail?: boolean; busy?: boolean; missing?: boolean;
  starting?: string[]; platform?: string; upFail?: string[]; incompatible?: string[]; apiCurrent?: string; failedService?: string;
  stopFailImage?: string; stopFailService?: string; interruptOnStart?: boolean;
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
  if(a.includes('ps')) finish(0, s.missing ? '' : a[a.length-1]);
  if(a.includes('stop')) { if(s.stopFail || s.stopFailImage===process.env.BOT_IMAGE || s.stopFailService===a[a.length-1]) finish(1); s['stopped_'+a[a.length-1]]=true; fs.writeFileSync(f,JSON.stringify(s)); finish(); }
  if(a.includes('up')) { if(s.interruptOnStart) { process.kill(process.ppid,'SIGTERM'); finish(1); } if(s.upFail?.includes(process.env.BOT_IMAGE)) finish(1); if(a[a.length-1]==='api') s.apiCurrent=process.env.BOT_IMAGE; else s.current=process.env.BOT_IMAGE; s['stopped_'+a[a.length-1]]=false; fs.writeFileSync(f,JSON.stringify(s)); finish(); }
}
if(a[0] === 'inspect') {
  const service=a[a.length-1];
  const current=service==='api'?(s.apiCurrent||s.current):s.current;
  const state=s['stopped_'+service]?'exited':'running';
  const health=s.starting?.includes(current)?'starting':(s.failed.includes(current)||s.failedService===service&&current===s.target)?'unhealthy':'healthy';
  finish(0, current+'|'+state+'|'+health);
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
    cwd: dir, encoding: 'utf8', timeout: commandTimeoutMs,
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

describe('Pi update lifecycle', { timeout: scenarioTimeoutMs }, () => {
  it('stops Bot then API and starts healthy API before Bot', () => {
    initialize(); clearCalls();
    expect(run().status).toBe(0);
    expect(calls().filter(c => c.includes('stop') || c.includes('up')).map(c => `${c.includes('stop') ? 'stop' : 'up'} ${c.at(-1)}`))
      .toEqual(['stop bot', 'stop api', 'up api', 'up bot']);
    expect(fixture.apiCurrent).toBe(next);
    expect(fixture.current).toBe(next);
  });
  it.each(['api', 'bot'])('rolls both services back if %s is unhealthy', service => {
    initialize(); clearCalls(); fixture.failedService = service;
    expect(run().status).not.toBe(0);
    expect(fixture.apiCurrent).toBe(old);
    expect(fixture.current).toBe(old);
    expect(state()).toContain('blocked=0');
  });
  it('refuses initial acceptance when the API uses a different digest', () => {
    fixture.apiCurrent = next;
    expect(run('--initialize', old).status).not.toBe(0);
  });
  it('archives an old state and accepts the v2 pair without a previous digest', () => {
    initialize();
    writeFileSync(join(dir, '.deploy-state/ci-disabled'), '');
    expect(run('--block').status).toBe(0);
    fixture.current = next; fixture.apiCurrent = next;
    expect(run('--accept-v2', next).status).toBe(0);
    expect(state()).toContain(`current=${next}\nprevious=\n`);
    expect(readFileSync(join(dir, '.deploy-state/state.before-v2'), 'utf8')).toContain(`current=${old}`);
  });
  it('persists blocked immediately when an in-progress process receives TERM', () => {
    initialize(); fixture.interruptOnStart = true;
    expect(run().status).not.toBe(0);
    expect(state()).toContain('blocked=1');
    expect(state()).toContain('pending=1');
  });
  it('blocks before rollback when the failed candidate cannot be stopped', () => {
    initialize(); fixture.failedService = 'bot'; fixture.stopFailImage = next; clearCalls();
    expect(run().status).not.toBe(0);
    expect(state()).toContain('blocked=1');
    expect(fixture.apiCurrent).toBe(next);
    expect(upCalls()).toHaveLength(2);
  });
  it('blocks when API stop fails after successfully stopping Bot', () => {
    initialize(); fixture.stopFailService = 'api'; clearCalls();
    expect(run().status).not.toBe(0);
    expect(state()).toContain('blocked=1');
    expect(upCalls()).toHaveLength(0);
  });
  it.each(['ci-enabled', 'unblocked', 'mismatched-api', 'schema', 'archived'])('refuses unsafe v2 acceptance: %s', reason => {
    initialize();
    if (reason !== 'ci-enabled') writeFileSync(join(dir, '.deploy-state/ci-disabled'), '');
    if (reason !== 'unblocked') expect(run('--block').status).toBe(0);
    fixture.current = next; fixture.apiCurrent = reason === 'mismatched-api' ? old : next;
    if (reason === 'schema') fixture.incompatible = [next];
    if (reason === 'archived') writeFileSync(join(dir, '.deploy-state/state.before-v2'), 'preserved');
    expect(run('--accept-v2', next).status).not.toBe(0);
    expect(state()).toContain(`current=${old}`);
  });

  it('refuses a schema-incompatible candidate before replacing the running Bot', () => {
    initialize(); fixture.incompatible = [next]; clearCalls();
    expect(run().status).not.toBe(0);
    expect(upCalls()).toHaveLength(0);
    expect(fixture.current).toBe(old);
  });
  it('never rolls back to an incompatible image without the DB schema checker', () => {
    initialize(); fixture.incompatible = [old]; fixture.failed = [next]; clearCalls();
    expect(run().status).not.toBe(0);
    expect(upCalls()).toHaveLength(0);
  });
  it('rejects manual recovery to an incompatible image', () => {
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
    expect(upCalls()).toHaveLength(0);
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
    expect(upCalls()).toHaveLength(3);
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
