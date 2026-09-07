import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

it.each(['valid', 'mismatched bot', 'mismatched API', 'missing bot', 'missing enabled', 'invalid enabled'])('validates composed service identities without exposing secrets: %s', scenario => {
  const bot = { DISCORD_BOT_TOKEN: 'secret-bot', CORE_API_TOKEN: 'secret-api' };
  const api: Record<string, string> = { ...bot, DISCORD_OUTPUT_ENABLED: 'false' };
  if (scenario === 'mismatched bot') api.DISCORD_BOT_TOKEN = 'secret-other';
  if (scenario === 'mismatched API') api.CORE_API_TOKEN = 'secret-other';
  if (scenario === 'missing bot') delete api.DISCORD_BOT_TOKEN;
  if (scenario === 'missing enabled') delete api.DISCORD_OUTPUT_ENABLED;
  if (scenario === 'invalid enabled') api.DISCORD_OUTPUT_ENABLED = 'yes';
  const result = spawnSync('python3', ['-B', 'deploy/verify-service-settings.py'], { input: JSON.stringify({ services: { bot: { environment: bot }, api: { environment: api } } }), encoding: 'utf8' });
  expect(result.status === 0).toBe(scenario === 'valid');
  expect(`${result.stdout}${result.stderr}`).not.toContain('secret');
});
