import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function metadata(): { metadata: { items: { key: string; value: string }[] } } {
  const values: Record<string, string> = {
    DISCORD_BOT_TOKEN: 'dummy-$TOKEN-"quoted"-\\backslash', CLIENT_ID: '123456',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'dummy@example.invalid', GOOGLE_SHEETS_SPREADSHEET_ID: 'dummy-sheet',
    GOOGLE_PRIVATE_KEY_B64: Buffer.from('-----BEGIN PRIVATE KEY-----\nDUMMY\n-----END PRIVATE KEY-----\n').toString('base64'),
    NODE_ENV: 'production'
  };
  return { metadata: { items: Object.entries(values).map(([key, value]) => ({ key: `env-${key}`, value })) } };
}
function convert(input: unknown): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['scripts/pi-env.mjs'], { input: JSON.stringify(input), encoding: 'utf8' });
}
it('generates six Compose variables and escapes interpolation, quotes and backslashes', () => {
  const result = convert(metadata());
  expect(result.status).toBe(0);
  expect(String(result.stdout).trim().split('\n')).toHaveLength(6);
  expect(result.stdout).toContain('DISCORD_BOT_TOKEN="dummy-$$TOKEN-\\"quoted\\"-\\\\backslash"');
  expect(result.stdout).toContain('GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\\\nDUMMY\\\\n-----END PRIVATE KEY-----\\\\n"');
  expect(result.stderr).toBe('');
});
it.each(['missing', 'duplicate', 'base64', 'newline'])('rejects %s input without partial output or leaked values', kind => {
  const input = metadata();
  if (kind === 'missing') input.metadata.items.pop();
  if (kind === 'duplicate') input.metadata.items.push(input.metadata.items[0]);
  if (kind === 'base64') input.metadata.items[4].value = 'SECRET-INVALID-BASE64';
  if (kind === 'newline') input.metadata.items[0].value = 'SECRET\nINJECTED=value';
  const result = convert(input);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(String(result.stderr)).not.toMatch(/SECRET|dummy/);
});

it('preserves dummy values through real Compose parsing and Config newline restoration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compose-env-'));
  try {
    const envFile = join(dir, '.env');
    const input = metadata();
    const converted = convert(input);
    expect(converted.status).toBe(0);
    writeFileSync(envFile, String(converted.stdout));
    const result = spawnSync('docker', ['compose', '--env-file', envFile, '-f', 'docker-compose.yml', 'config', '--format', 'json'], {
      encoding: 'utf8', env: { ...process.env, BOT_ENV_FILE: envFile,
        BOT_IMAGE: `ghcr.io/yone-k/yone-discord-bot@sha256:${'a'.repeat(64)}` }
    });
    expect(result.status, result.stderr).toBe(0);
    const config = JSON.parse(result.stdout);
    const env = config.services.bot.environment;
    // `config` serializes literal dollars as $$ so the output can be reused as
    // Compose input. Runtime delivery of the dummy value is verified separately.
    expect(env.DISCORD_BOT_TOKEN.replace(/\$\$/g, '$')).toBe(input.metadata.items[0].value);
    expect(env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')).toBe(Buffer.from(input.metadata.items[4].value, 'base64').toString('utf8'));
    expect(config.name).toBe('discord-bot');
    expect(config.services.bot.restart).toBe('unless-stopped');
    expect(config.services.bot.ports[0].host_ip).toBe('127.0.0.1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
