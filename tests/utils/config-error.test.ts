import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Config, ConfigError } from '../../src/utils/config';

describe('Config Error Handling Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // 環境変数を保存
    originalEnv = { ...process.env };
    process.env.CORE_API_URL = 'http://api:8080';
    process.env.CORE_API_TOKEN = 'synthetic-token';
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

});
