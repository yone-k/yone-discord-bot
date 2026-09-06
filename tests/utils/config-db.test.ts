import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Core API Bot configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DISCORD_BOT_TOKEN', 'synthetic-token');
    vi.stubEnv('CLIENT_ID', '123');
    vi.stubEnv('CORE_API_URL', 'http://api:8080');
    vi.stubEnv('CORE_API_TOKEN', 'synthetic-token');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('loads Discord and Core API configuration without persistence settings', async () => {
    const { Config } = await import('../../src/utils/config');
    expect(Config.getInstance().getCoreApiUrl()).toBe('http://api:8080');
    expect(Config.getInstance().get()).not.toHaveProperty('databaseUrl');
    expect(Config.getInstance().get()).not.toHaveProperty('googleSheets');
  });
  it('rejects missing API configuration', async () => {
    vi.stubEnv('CORE_API_TOKEN', '');
    const { Config } = await import('../../src/utils/config');
    expect(() => Config.getInstance()).toThrow('CORE_API_TOKEN');
  });
  it('rejects invalid URLs without revealing the supplied value', async () => {
    vi.stubEnv('CORE_API_URL', 'secret-invalid');
    const { Config } = await import('../../src/utils/config');
    expect(() => Config.getInstance()).toThrow('CORE_API_URL must be an HTTP(S) origin without credentials');
  });
});
