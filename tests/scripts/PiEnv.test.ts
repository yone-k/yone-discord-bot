import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function metadata(): Record<string, string> {
  const values: Record<string, string> = {
    DISCORD_BOT_TOKEN: 'dummy-$TOKEN-"quoted"-\\backslash', CLIENT_ID: '123456',
    CORE_API_URL: 'http://api:8080', CORE_API_TOKEN: 'synthetic-api-token',
    NODE_ENV: 'production'
  };
  return values;
}
function convert(input: unknown): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['scripts/pi-env.mjs'], { input: JSON.stringify(input), encoding: 'utf8' });
}
it('generates five Discord adapter variables and escapes interpolation, quotes and backslashes', () => {
  const result = convert(metadata());
  expect(result.status).toBe(0);
  expect(String(result.stdout).trim().split('\n')).toHaveLength(5);
  expect(result.stdout).toContain('DISCORD_BOT_TOKEN="dummy-$$TOKEN-\\"quoted\\"-\\\\backslash"');
  expect(result.stdout).toContain('CORE_API_URL="http://api:8080"');
  expect(result.stdout).not.toContain('DATABASE_URL');
  expect(result.stdout).not.toContain('GOOGLE_');
  expect(result.stderr).toBe('');
});
it.each(['missing', 'admin', 'url', 'newline'])('rejects %s input without partial output or leaked values', kind => {
  const input = metadata();
  if (kind === 'missing') delete input.CORE_API_URL;
  if (kind === 'admin') input.DATABASE_ADMIN_URL = 'SECRET';
  if (kind === 'url') input.CORE_API_URL = 'SECRET';
  if (kind === 'newline') input.DISCORD_BOT_TOKEN = 'SECRET\nINJECTED=value';
  const result = convert(input);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(String(result.stderr)).not.toMatch(/SECRET|dummy/);
});

it('generates API credentials separately and rejects Discord or admin credentials', () => {
  const input = { DATABASE_URL: 'postgresql://bot:dummy@db/discord_bot', CORE_API_TOKEN: 'synthetic-token' };
  const run = (value: unknown): ReturnType<typeof spawnSync> => spawnSync(process.execPath, ['scripts/pi-env.mjs', 'api'], {
    input: JSON.stringify(value), encoding: 'utf8'
  });
  expect(run(input).status).toBe(0);
  expect(String(run(input).stdout).trim().split('\n')).toHaveLength(2);
  expect(run({ ...input, DISCORD_BOT_TOKEN: 'secret' }).status).not.toBe(0);
  expect(run({ ...input, DATABASE_ADMIN_URL: 'secret' }).stdout).toBe('');
});

it('preserves dummy values through real Compose parsing without admin credentials on Bot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compose-env-'));
  try {
    const envFile = join(dir, '.env');
    const input = metadata();
    const converted = convert(input);
    expect(converted.status).toBe(0);
    writeFileSync(envFile, String(converted.stdout));
    writeFileSync(join(dir, '.env.api'), 'DATABASE_URL=postgresql://bot:dummy@db/discord_bot\nCORE_API_TOKEN=synthetic-api-token\n');
    writeFileSync(join(dir, '.env.db-admin'), 'POSTGRES_PASSWORD=dummy-admin\n');
    // Compose startup can exceed the unit-test timeout on shared CI runners.
    // Bound the subprocess separately so a hung CLI cannot block the worker.
    const result = spawnSync('docker', ['compose', '--env-file', envFile, '-f', 'docker-compose.yml', 'config', '--format', 'json'], {
      encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL',
      env: { ...process.env, BOT_ENV_FILE: envFile, API_ENV_FILE: join(dir, '.env.api'), DB_ADMIN_ENV_FILE: join(dir, '.env.db-admin'), STORAGE_UUID: 'synthetic-uuid',
        BOT_IMAGE: `ghcr.io/yone-k/yone-discord-bot@sha256:${'a'.repeat(64)}` }
    });
    expect(result.error, 'Docker Compose must complete within 20 seconds').toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const config = JSON.parse(result.stdout);
    const env = config.services.bot.environment;
    // `config` serializes literal dollars as $$ so the output can be reused as
    // Compose input. Runtime delivery of the dummy value is verified separately.
    expect(env.DISCORD_BOT_TOKEN.replace(/\$\$/g, '$')).toBe(input.DISCORD_BOT_TOKEN);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.CORE_API_URL).toBe(input.CORE_API_URL);
    expect(config.services.api.environment.DISCORD_BOT_TOKEN).toBeUndefined();
    expect(config.services.api.ports).toBeUndefined();
    expect(config.services.api.image).toBe(config.services.bot.image);
    expect(config.services.bot.depends_on.api.condition).toBe('service_healthy');
    expect(env.POSTGRES_PASSWORD).toBeUndefined();
    expect(config.services.db.ports).toBeUndefined();
    expect(config.name).toBe('discord-bot');
    expect(config.services.bot.restart).toBe('unless-stopped');
    expect(config.services.bot.ports[0].host_ip).toBe('127.0.0.1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
