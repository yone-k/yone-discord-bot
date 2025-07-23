import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { GoogleSheetsService, GoogleSheetsError, GoogleSheetsErrorType } from '../../src/services/GoogleSheetsService';
import { Config } from '../../src/utils/config';

describe('GoogleSheetsService Error Handling Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    (GoogleSheetsService as any).instance = undefined;
    (Config as any).instance = undefined;
    
    // Discord設定は正常に設定
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
  });

  afterEach(() => {
    process.env = originalEnv;
    (GoogleSheetsService as any).instance = undefined;
    (Config as any).instance = undefined;
    vi.restoreAllMocks();
  });


  describe('Google Sheets設定未設定時のエラーハンドリング', () => {
    test('Google Sheets設定未設定時にCONFIG_MISSINGエラー', () => {
      // Google Sheets設定を削除
      delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      delete process.env.GOOGLE_PRIVATE_KEY;

      expect(() => GoogleSheetsService.getInstance()).toThrow(GoogleSheetsError);
      
      try {
        GoogleSheetsService.getInstance();
      } catch (error) {
        const gsError = error as GoogleSheetsError;
        expect(gsError.type).toBe(GoogleSheetsErrorType.CONFIG_MISSING);
        expect(gsError.userMessage).toBe('Google Sheetsの設定が見つかりません。環境変数を確認してください。');
      }
    });

    test('Google Sheets設定部分的未設定時にCONFIG_MISSINGエラー', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-id';
      // 他の設定は未設定

      expect(() => GoogleSheetsService.getInstance()).toThrow(GoogleSheetsError);
      
      try {
        GoogleSheetsService.getInstance();
      } catch (error) {
        const gsError = error as GoogleSheetsError;
        expect(gsError.type).toBe(GoogleSheetsErrorType.CONFIG_MISSING);
      }
    });
  });

  describe('認証エラーハンドリング', () => {
    test('空のプライベートキーでCONFIG_MISSINGエラー', () => {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.com';
      process.env.GOOGLE_PRIVATE_KEY = '';
      
      expect(() => GoogleSheetsService.getInstance()).toThrow(GoogleSheetsError);
      
      try {
        GoogleSheetsService.getInstance();
      } catch (error) {
        const gsError = error as GoogleSheetsError;
        expect(gsError.type).toBe(GoogleSheetsErrorType.CONFIG_MISSING);
      }
    });
  });

  describe('データ検証エラーハンドリング', () => {
    beforeEach(() => {
      // データ検証テスト用にGoogle Sheets設定を有効化
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.com';
      process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\ntest-key\\n-----END PRIVATE KEY-----';
    });

    test('必要な列数が不足しているデータの検証エラー', () => {
      const service = GoogleSheetsService.getInstance();
      
      const invalidData = [
        [], // 0列（空の行）
        [] // 0列（空の行）
      ];

      const result = service.validateData(invalidData);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('行 1: 必要な列数が不足しています');
      expect(result.errors).toContain('行 2: 必要な列数が不足しています');
    });

    test('空のIDがあるデータの検証エラー', () => {
      const service = GoogleSheetsService.getInstance();
      
      const invalidData = [
        ['', 'name', 'category', 'date'], // 空のID
        ['  ', 'name2', 'category2', 'date2'] // 空白のID
      ];

      const result = service.validateData(invalidData);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('行 1: 1列目が空です');
      expect(result.errors).toContain('行 2: 1列目が空です');
    });

    test('不正な日付形式があるデータの検証エラー', () => {
      const service = GoogleSheetsService.getInstance();
      
      const invalidData = [
        ['1', 'name', 'category', '2023-99-99'], // 不正な日付
        ['2', 'name2', 'category2', '2023-13-45'] // 不正な日付
      ];

      const result = service.validateData(invalidData);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('行 1: 列 4 の日付形式が正しくありません');
      expect(result.errors).toContain('行 2: 列 4 の日付形式が正しくありません');
    });

    test('正常なデータの検証成功', () => {
      const service = GoogleSheetsService.getInstance();
      
      const validData = [
        ['1', 'name', 'category', '2023-01-01'],
        ['2', 'name2', 'category2', '2023-12-31']
      ];

      const result = service.validateData(validData);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('リトライ機能の動作確認', () => {
    beforeEach(() => {
      // リトライテスト用にGoogle Sheets設定を有効化
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.com';
      process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\ntest-key\\n-----END PRIVATE KEY-----';
    });

    test('レート制限エラー(429)でリトライを実行', async () => {
      const service = GoogleSheetsService.getInstance();
      
      let callCount = 0;
      const mockOperation = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          const error = new Error('Rate limited');
          (error as any).code = 429;
          throw error;
        }
        return 'success';
      });

      const result = await (service as any).executeWithRetry(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    test('リトライ不可能なエラー(400)で即座に失敗', async () => {
      const service = GoogleSheetsService.getInstance();
      
      const mockOperation = vi.fn().mockImplementation(() => {
        const error = new Error('Bad request');
        (error as any).code = 400;
        throw error;
      });

      await expect((service as any).executeWithRetry(mockOperation)).rejects.toThrow('Bad request');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    test('最大リトライ回数を超えた場合は失敗', async () => {
      const service = GoogleSheetsService.getInstance();
      
      const mockOperation = vi.fn().mockImplementation(() => {
        const error = new Error('Server error');
        (error as any).code = 500;
        throw error;
      });

      await expect((service as any).executeWithRetry(mockOperation)).rejects.toThrow('Server error');
      expect(mockOperation).toHaveBeenCalledTimes(3); // maxRetries = 3
    });
  });
});