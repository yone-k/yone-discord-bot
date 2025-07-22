import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Config } from '../../src/utils/config';

describe('Config', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // 既存の必須環境変数をセット
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
  });

  afterEach(() => {
    process.env = originalEnv
    // シングルトンインスタンスをリセット
    ;(Config as any).instance = undefined;
  });

  describe('Google Sheets環境変数', () => {
    it('GOOGLE_SHEETS_SPREADSHEET_IDが正しく取得できる', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
      process.env.GOOGLE_PRIVATE_KEY = 'test-key';
      
      const config = Config.getInstance();
      const googleConfig = config.getGoogleSheetsConfig();
      
      expect(googleConfig).toBeDefined();
      expect(googleConfig!.spreadsheetId).toBe('test-spreadsheet-id');
    });

    it('GOOGLE_SERVICE_ACCOUNT_EMAILが正しく取得できる', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
      process.env.GOOGLE_PRIVATE_KEY = 'test-key';
      
      const config = Config.getInstance();
      const googleConfig = config.getGoogleSheetsConfig();
      
      expect(googleConfig).toBeDefined();
      expect(googleConfig!.serviceAccountEmail).toBe('test@service.account');
    });

    it('GOOGLE_PRIVATE_KEYが正しく取得できる（改行文字処理含む）', () => {
      const privateKey = '-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\\n-----END PRIVATE KEY-----\\n';
      const expectedKey = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n';
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
      process.env.GOOGLE_PRIVATE_KEY = privateKey;
      
      const config = Config.getInstance();
      const googleConfig = config.getGoogleSheetsConfig();
      
      expect(googleConfig).toBeDefined();
      expect(googleConfig!.privateKey).toBe(expectedKey);
    });

    it('Google Sheets設定が未設定の場合はundefinedを返す', () => {
      const config = Config.getInstance();
      const googleConfig = config.getGoogleSheetsConfig();
      
      expect(googleConfig).toBeUndefined();
    });

    it('Google Sheets設定が部分的に設定されている場合はundefinedを返す', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      // EMAIL と PRIVATE_KEY は未設定
      
      const config = Config.getInstance();
      const googleConfig = config.getGoogleSheetsConfig();
      
      expect(googleConfig).toBeUndefined();
    });

    it('GOOGLE_SHEETS_SPREADSHEET_IDが空文字の場合はundefinedを返す', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = '';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
      process.env.GOOGLE_PRIVATE_KEY = 'test-key';
      
      const config = Config.getInstance();
      const googleConfig = config.getGoogleSheetsConfig();
      
      expect(googleConfig).toBeUndefined();
    });

    it('GOOGLE_SERVICE_ACCOUNT_EMAILが空文字の場合はundefinedを返す', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = '';
      process.env.GOOGLE_PRIVATE_KEY = 'test-key';
      
      const config = Config.getInstance();
      const googleConfig = config.getGoogleSheetsConfig();
      
      expect(googleConfig).toBeUndefined();
    });

    it('GOOGLE_PRIVATE_KEYが空文字の場合はundefinedを返す', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
      process.env.GOOGLE_PRIVATE_KEY = '';
      
      const config = Config.getInstance();
      const googleConfig = config.getGoogleSheetsConfig();
      
      expect(googleConfig).toBeUndefined();
    });
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