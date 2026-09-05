import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Config } from '../../src/utils/config';

describe('Config', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // 既存の必須環境変数をセット
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
  });

  afterEach(() => {
    process.env = originalEnv
    // シングルトンインスタンスをリセット
    ;(Config as any).instance = undefined;
  });

  describe('既存機能への影響確認', () => {
    it('Google Sheets設定が未設定でも既存のDiscord設定は正常に取得できる', () => {
      const config = Config.getInstance();
      
      expect(config.getDiscordToken()).toBe('test-token');
      expect(config.getClientId()).toBe('test-client-id');
    });

    it('Google Sheets設定が設定済みでも既存のDiscord設定は正常に取得できる', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
      process.env.GOOGLE_PRIVATE_KEY = 'test-key';
      
      const config = Config.getInstance();
      
      expect(config.getDiscordToken()).toBe('test-token');
      expect(config.getClientId()).toBe('test-client-id');
    });
  });
});