import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startDiscordBoundary } from '../tests/api-integration/fake-discord.mjs';

// This suite destroys only an explicitly named, local *_http test database.
const root = resolve(import.meta.dirname, '..');
const raw = process.env.TEST_DATABASE_URL;
const container = process.env.TEST_DB_CONTAINER_ID;
if (!raw || !container) throw new Error('TEST_DATABASE_URL and TEST_DB_CONTAINER_ID are required');
const url = new URL(raw);
const database = url.pathname.slice(1);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || !/^[a-z][a-z0-9_]*_http$/.test(database) || url.search) {
  throw new Error('Requires a loopback PostgreSQL URL with an explicit dedicated *_http database');
}
function command(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, encoding: 'utf8', timeout: 180000, ...options });
  if (result.error || result.status !== 0) throw new Error(`${file} failed: ${result.stderr || result.error?.message || result.status}`);
  return result.stdout.trim();
}
const inspected = JSON.parse(command('docker', ['inspect', container]))[0];
const mappings = inspected.NetworkSettings.Ports['5432/tcp'] ?? [];
if (!inspected.State.Running || !mappings.some(p => ['127.0.0.1', '0.0.0.0'].includes(p.HostIp) && p.HostPort === (url.port || '5432'))) throw new Error('URL does not identify the nominated running container');
const username = decodeURIComponent(url.username);
const environment = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
function psql(sql, db = database, remote = false) {
  return command('docker', ['exec', '-i', '-e', 'PGPASSWORD', container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', username, '-d', db,
    ...(remote ? ['-h', 'host.docker.internal', '-p', url.port || '5432'] : [] )], { input: sql, env: environment });
}
const identity = psql('SELECT system_identifier::text FROM pg_control_system()', 'postgres');
if (!/^\d+$/.test(identity) || identity !== psql('SELECT system_identifier::text FROM pg_control_system()', 'postgres', true)) throw new Error('Target connection and container cluster identities differ');
if (!psql('SHOW server_version_num', 'postgres').startsWith('18')) throw new Error('PostgreSQL 18 required');
// Refuse to take over an unrelated API already bound to the fixed runtime port.
const probe = createServer();
probe.listen(8080);
await once(probe, 'listening');
await new Promise(resolve => probe.close(resolve));
if (psql(`SELECT 1 FROM pg_database WHERE datname='${database}'`, 'postgres') !== '1') psql(`CREATE DATABASE "${database}"`, 'postgres');
const role = `${database}_api`;
if (role.length > 63) throw new Error('Test database name too long');
const password = randomBytes(24).toString('hex');
const runId = randomBytes(12).toString('hex');
const restoreDatabase = `${database.slice(0, 25)}_restore_${runId}`;
if (psql(`SELECT 1 FROM pg_roles WHERE rolname='${role}'`, 'postgres') !== '1') psql(`CREATE ROLE "${role}" LOGIN`, 'postgres');
psql(`ALTER ROLE "${role}" PASSWORD '${password}'; DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
const directory = resolve(root, '.agent_tmp', 'api-integration', `${process.pid}`);
await mkdir(directory, { recursive: true });
let api;
let tests;
let discord;
let cleanupStarted = false;
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  await exited;
  clearTimeout(timer);
}
async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  await stop(tests);
  await stop(api);
  await discord?.close();
  try {
    psql(`DROP DATABASE IF EXISTS "${restoreDatabase}" WITH (FORCE)`, 'postgres');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
try {
  command('go', ['build', '-o', resolve(directory, 'db-migrate'), './cmd/db-migrate'], { cwd: resolve(root, 'backend') });
  command(resolve(directory, 'db-migrate'), [], { env: { ...process.env, DATABASE_ADMIN_URL: raw, DATABASE_BOT_ROLE: role, MIGRATIONS_DIR: resolve(root, 'db/migrations') } });
  psql(`INSERT INTO data_imports(singleton,snapshot_sha256,schema_version,completed_at,report) VALUES(true,repeat('0',64),1,CURRENT_TIMESTAMP,'{}');`);
  command('go', ['build', '-o', resolve(directory, 'api'), './cmd/api'], { cwd: resolve(root, 'backend') });
  const limited = new URL(raw); limited.username = role; limited.password = password;
  const token = randomBytes(24).toString('hex');
  const env = { ...process.env, DISCORD_OUTPUT_ENABLED: 'false', DATABASE_URL: limited.toString(), CORE_API_URL: 'http://127.0.0.1:8080', CORE_API_TOKEN: token, MIGRATIONS_DIR: resolve(root, 'db/migrations'), API_INTEGRATION_CLUSTER_ID: identity, API_INTEGRATION_RUN_ID: runId };
  api = spawn(resolve(directory, 'api'), [], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; api.stdout.on('data', chunk => { logs += chunk; }); api.stderr.on('data', chunk => { logs += chunk; });
  const deadline = Date.now() + 15000;
  for (;;) {
    if (api.exitCode !== null) throw new Error(`API exited before readiness: ${logs}`);
    try { const response = await fetch(`${env.CORE_API_URL}/health`, { signal: AbortSignal.timeout(500) }); if (response.ok && (await response.json()).ready) break; } catch { /* poll readiness until deadline */ }
    if (Date.now() >= deadline) throw new Error(`API readiness timed out: ${logs}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  tests = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.api-integration.config.ts', 'bot.integration.ts', 'backup.integration.ts'], { cwd: root, env, stdio: 'inherit' });
  // Includes the 90s backup scenario, eight 15s API scenarios and hook budgets.
  const watchdog = setTimeout(() => { tests.kill('SIGKILL'); }, 300000);
  try { const [status] = await once(tests, 'exit'); process.exitCode = status ?? 1; }
  finally { clearTimeout(watchdog); }
  if (!process.exitCode) {
    await stop(api);
    psql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    command(resolve(directory, 'db-migrate'), [], { env: { ...process.env, DATABASE_ADMIN_URL: raw, DATABASE_BOT_ROLE: role, MIGRATIONS_DIR: resolve(root, 'db/migrations') } });
    psql(`INSERT INTO data_imports(singleton,snapshot_sha256,schema_version,completed_at,report) VALUES(true,repeat('0',64),1,CURRENT_TIMESTAMP,'{}');`);
    command('go', ['test', '-c', '-tags=integration', '-o', resolve(directory, 'output-api'), './cmd/api'], { cwd: resolve(root, 'backend') });
    discord = await startDiscordBoundary(nonce => psql(`SELECT count(*) FROM output_dispatches WHERE nonce='${nonce}' AND outcome='unknown'`) === '1');
    const enabledEnv = { ...env, DISCORD_OUTPUT_ENABLED: 'true', DISCORD_BOT_TOKEN: 'integration-output-token', ISSUE44_RUNTIME_CHILD: '1', ISSUE44_RUNTIME_DISCORD: discord.url };
    api = spawn(resolve(directory, 'output-api'), ['-test.run=^TestOutputRuntimeChild$', '-test.timeout=90s'], { cwd: root, env: enabledEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    logs = ''; api.stdout.on('data', chunk => { logs += chunk; }); api.stderr.on('data', chunk => { logs += chunk; });
    const enabledDeadline = Date.now() + 15000;
    for (;;) {
      if (api.exitCode !== null) throw new Error(`Output API exited before readiness: ${logs}`);
      try {
        const response = await fetch(`${env.CORE_API_URL}/v1/outputs/status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(500) });
        const state = await response.json();
        if (response.ok && state.enabled && state.workerRunning) break;
      } catch { /* poll worker readiness until deadline */ }
      if (Date.now() >= enabledDeadline) throw new Error(`Output worker readiness timed out: ${logs}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    tests = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.api-integration.config.ts', 'output.integration.ts'], { cwd: root, env: enabledEnv, stdio: 'inherit' });
    const outputWatchdog = setTimeout(() => tests.kill('SIGKILL'), 60000);
    try { const [status] = await once(tests, 'exit'); process.exitCode = status ?? 1; }
    finally { clearTimeout(outputWatchdog); }
    if (process.exitCode) process.stderr.write(logs);
  }
} finally { await cleanup(); }
