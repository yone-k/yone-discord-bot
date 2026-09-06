import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Config } from '../../src/utils/config';

describe('Config', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // 既存の必須環境変数をセット
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
    process.env.CORE_API_URL = 'http://api:8080';
    process.env.CORE_API_TOKEN = 'synthetic-token';
  });

  afterEach(() => {
    process.env = originalEnv
    // シングルトンインスタンスをリセット
    ;(Config as any).instance = undefined;
  });

  describe('DiscordとCore APIの接続設定', () => {
    it('Discord設定を取得できる', () => {
      const config = Config.getInstance();
      
      expect(config.getDiscordToken()).toBe('test-token');
      expect(config.getClientId()).toBe('test-client-id');
    });

    it('Core API設定の前後空白を取り除く', () => {
      process.env.CORE_API_URL = ' http://api:8080 ';
      process.env.CORE_API_TOKEN = ' synthetic-token\n';
      
      const config = Config.getInstance();
      
      expect(config.getCoreApiUrl()).toBe('http://api:8080');
      expect(config.getCoreApiToken()).toBe('synthetic-token');
    });
  });
});
