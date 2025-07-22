import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Config, ConfigError } from '../../src/utils/config';

describe('Config Error Handling Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // 環境変数を保存
    originalEnv = { ...process.env };
    // Configのシングルトンをリセット
    (Config as any).instance = undefined;
  });

  afterEach(() => {
    // 環境変数を復元
    process.env = originalEnv;
    // Configのシングルトンをリセット
    (Config as any).instance = undefined;
  });

  describe('環境変数未設定時のエラーハンドリング', () => {
    test('DISCORD_BOT_TOKEN未設定時に適切なエラーメッセージを表示', () => {
      delete process.env.DISCORD_BOT_TOKEN;
      process.env.CLIENT_ID = 'test-client-id';

      expect(() => Config.getInstance()).toThrow(ConfigError);
      expect(() => Config.getInstance()).toThrow(
        'Missing required environment variables: DISCORD_BOT_TOKEN. Please check your .env file and ensure all required variables are set.'
      );
    });

    test('CLIENT_ID未設定時に適切なエラーメッセージを表示', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-token';
      delete process.env.CLIENT_ID;

      expect(() => Config.getInstance()).toThrow(ConfigError);
      expect(() => Config.getInstance()).toThrow(
        'Missing required environment variables: CLIENT_ID. Please check your .env file and ensure all required variables are set.'
      );
    });

    test('複数の環境変数未設定時に適切なエラーメッセージを表示', () => {
      delete process.env.DISCORD_BOT_TOKEN;
      delete process.env.CLIENT_ID;

      expect(() => Config.getInstance()).toThrow(ConfigError);
      expect(() => Config.getInstance()).toThrow(
        'Missing required environment variables: DISCORD_BOT_TOKEN, CLIENT_ID. Please check your .env file and ensure all required variables are set.'
      );
    });

    test('DISCORD_BOT_TOKEN空文字時に適切なエラーメッセージを表示', () => {
      process.env.DISCORD_BOT_TOKEN = '';
      process.env.CLIENT_ID = 'test-client-id';

      expect(() => Config.getInstance()).toThrow(ConfigError);
      expect(() => Config.getInstance()).toThrow(
        'Missing required environment variables: DISCORD_BOT_TOKEN. Please check your .env file and ensure all required variables are set.'
      );
    });

    test('CLIENT_ID空文字時に適切なエラーメッセージを表示', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-token';
      process.env.CLIENT_ID = '';

      expect(() => Config.getInstance()).toThrow(ConfigError);
      expect(() => Config.getInstance()).toThrow(
        'Missing required environment variables: CLIENT_ID. Please check your .env file and ensure all required variables are set.'
      );
    });

    test('DISCORD_BOT_TOKEN空白文字時に適切なエラーメッセージを表示', () => {
      process.env.DISCORD_BOT_TOKEN = '   ';
      process.env.CLIENT_ID = 'test-client-id';

      expect(() => Config.getInstance()).toThrow(ConfigError);
      expect(() => Config.getInstance()).toThrow(
        'Missing required environment variables: DISCORD_BOT_TOKEN. Please check your .env file and ensure all required variables are set.'
      );
    });
  });

  describe('Google Sheets設定エラーハンドリング', () => {
    beforeEach(() => {
      // Discord設定は正常に設定
      process.env.DISCORD_BOT_TOKEN = 'test-token';
      process.env.CLIENT_ID = 'test-client-id';
    });

    test('Google Sheets設定が部分的に未設定の場合はundefinedを返す', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      // 他の設定は未設定

      const config = Config.getInstance();
      expect(config.getGoogleSheetsConfig()).toBeUndefined();
    });

    test('Google Sheets設定がすべて空文字の場合はundefinedを返す', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = '';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = '';
      process.env.GOOGLE_PRIVATE_KEY = '';

      const config = Config.getInstance();
      expect(config.getGoogleSheetsConfig()).toBeUndefined();
    });

    test('Google Sheets設定が一部空文字の場合はundefinedを返す', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = '';
      process.env.GOOGLE_PRIVATE_KEY = 'test-private-key';

      const config = Config.getInstance();
      expect(config.getGoogleSheetsConfig()).toBeUndefined();
    });

    test('Google Sheets設定が正常な場合は設定オブジェクトを返す', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.com';
      process.env.GOOGLE_PRIVATE_KEY = 'test-private-key\\nwith\\nnewlines';

      const config = Config.getInstance();
      const googleConfig = config.getGoogleSheetsConfig();

      expect(googleConfig).toBeDefined();
      expect(googleConfig!.spreadsheetId).toBe('test-spreadsheet-id');
      expect(googleConfig!.serviceAccountEmail).toBe('test@example.com');
      expect(googleConfig!.privateKey).toBe('test-private-key\nwith\nnewlines');
    });
  });
});