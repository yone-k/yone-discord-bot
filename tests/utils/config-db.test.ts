import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('PostgreSQL Bot configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DISCORD_BOT_TOKEN', 'synthetic-token');
    vi.stubEnv('CLIENT_ID', '123');
    vi.stubEnv('DATABASE_URL', 'postgresql://bot:synthetic@localhost/example');
    vi.stubEnv('GOOGLE_SHEETS_SPREADSHEET_ID', '');
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', '');
    vi.stubEnv('GOOGLE_PRIVATE_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('starts configuration without any Google credentials', async () => {
    const { Config } = await import('../../src/utils/config');
    expect(Config.getInstance().getDatabaseUrl()).toBe('postgresql://bot:synthetic@localhost/example');
    expect(Config.getInstance().get()).not.toHaveProperty('googleSheets');
  });
  it('rejects missing database configuration', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { Config } = await import('../../src/utils/config');
    expect(() => Config.getInstance()).toThrow('DATABASE_URL');
  });
  it('rejects invalid URLs without revealing the supplied value', async () => {
    vi.stubEnv('DATABASE_URL', 'secret-invalid');
    const { Config } = await import('../../src/utils/config');
    expect(() => Config.getInstance()).toThrow('DATABASE_URL must use postgresql:// or postgres://');
  });
});
