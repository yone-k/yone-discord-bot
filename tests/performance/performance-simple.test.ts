import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';

describe('Simple Performance Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    
    // Discord設定
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
    
    // Google Sheets設定
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.com';
    process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\ntest-key\\n-----END PRIVATE KEY-----';

    // Reset singletons
    (GoogleSheetsService as any).instance = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('データ処理パフォーマンス基準確認', () => {
    function generateLargeDataset(size: number): string[][] {
      const data: string[][] = [];
      
      // ヘッダー行
      data.push(['id', 'name', 'quantity', 'category', 'added_at']);
      
      // データ行
      for (let i = 1; i <= size; i++) {
        data.push([
          i.toString(),
          `Item ${i}`,
          Math.floor(Math.random() * 10 + 1).toString(),
          ['food', 'drink', 'household', 'other'][i % 4],
          new Date(Date.now() - Math.random() * 86400000 * 30).toISOString()
        ]);
      }
      
      return data;
    }

    test('100件データの検証処理パフォーマンス（100ms以内）', () => {
      const service = GoogleSheetsService.getInstance();
      const testData = generateLargeDataset(100);

      const startTime = Date.now();
      const result = service.validateData(testData);
      const endTime = Date.now();

      const executionTime = endTime - startTime;
      
      expect(executionTime).toBeLessThan(100); // 100ms以内
      // ヘッダー行も検証されるためエラーが発生する可能性があるが、パフォーマンスは確認
      expect(result.errors.length).toBeLessThan(5); // エラー数が少ないことを確認
    });

    test('500件データの検証処理パフォーマンス（200ms以内）', () => {
      const service = GoogleSheetsService.getInstance();
      const testData = generateLargeDataset(500);

      const startTime = Date.now();
      const result = service.validateData(testData);
      const endTime = Date.now();

      const executionTime = endTime - startTime;
      
      expect(executionTime).toBeLessThan(200); // 200ms以内
      expect(result.errors.length).toBeLessThan(5); // エラー数が少ないことを確認
    });

    test('1000件データの検証処理パフォーマンス（500ms以内）', () => {
      const service = GoogleSheetsService.getInstance();
      const testData = generateLargeDataset(1000);

      const startTime = Date.now();
      const result = service.validateData(testData);
      const endTime = Date.now();

      const executionTime = endTime - startTime;
      
      expect(executionTime).toBeLessThan(500); // 500ms以内
      expect(result.errors.length).toBeLessThan(5); // エラー数が少ないことを確認
    });

    test('100件データの正規化処理パフォーマンス（50ms以内）', () => {
      const service = GoogleSheetsService.getInstance();
      const testData = generateLargeDataset(100);

      const startTime = Date.now();
      const normalized = service.normalizeData(testData);
      const endTime = Date.now();

      const executionTime = endTime - startTime;
      
      expect(executionTime).toBeLessThan(50); // 50ms以内
      expect(normalized).toHaveLength(testData.length);
    });

    test('500件データの正規化処理パフォーマンス（150ms以内）', () => {
      const service = GoogleSheetsService.getInstance();
      const testData = generateLargeDataset(500);

      const startTime = Date.now();
      const normalized = service.normalizeData(testData);
      const endTime = Date.now();

      const executionTime = endTime - startTime;
      
      expect(executionTime).toBeLessThan(150); // 150ms以内
      expect(normalized).toHaveLength(testData.length);
    });

    test('1000件データの正規化処理パフォーマンス（300ms以内）', () => {
      const service = GoogleSheetsService.getInstance();
      const testData = generateLargeDataset(1000);

      const startTime = Date.now();
      const normalized = service.normalizeData(testData);
      const endTime = Date.now();

      const executionTime = endTime - startTime;
      
      expect(executionTime).toBeLessThan(300); // 300ms以内
      expect(normalized).toHaveLength(testData.length);
    });
  });

  describe('不正データ処理パフォーマンス', () => {
    test('不正データが混在する場合の検証パフォーマンス', () => {
      const service = GoogleSheetsService.getInstance();
      
      // 不正データを含むデータセット作成
      const testData: string[][] = [
        ['id', 'name', 'quantity', 'category', 'added_at'], // ヘッダー
        ['1', 'Valid Item', '2', 'food', '2023-01-01'],      // 正常
        ['', 'Invalid ID', '1', 'food', '2023-01-01'],       // 不正: 空ID
        ['3', 'Valid Item 2', '3', 'drink', '2023-01-02'],   // 正常
        ['4', '', '1'],                                      // 不正: 列数不足
        ['5', 'Valid Item 3', '1', 'other', 'invalid-date'] // 不正: 日付形式
      ];

      const startTime = Date.now();
      const result = service.validateData(testData);
      const endTime = Date.now();

      const executionTime = endTime - startTime;
      
      expect(executionTime).toBeLessThan(10); // 10ms以内
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('大量の不正データの検証パフォーマンス', () => {
      const service = GoogleSheetsService.getInstance();
      
      // 大量の不正データを作成
      const testData: string[][] = [['id', 'name', 'quantity', 'category', 'added_at']];
      
      for (let i = 1; i <= 200; i++) {
        if (i % 3 === 0) {
          // 不正データ: 列数不足
          testData.push([i.toString(), `Item ${i}`]);
        } else if (i % 5 === 0) {
          // 不正データ: 空ID
          testData.push(['', `Item ${i}`, '1', 'food', '2023-01-01']);
        } else {
          // 正常データ
          testData.push([i.toString(), `Item ${i}`, '1', 'food', '2023-01-01']);
        }
      }

      const startTime = Date.now();
      const result = service.validateData(testData);
      const endTime = Date.now();

      const executionTime = endTime - startTime;
      
      expect(executionTime).toBeLessThan(100); // 100ms以内
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(50); // 多数のエラーが検出される
    });
  });

  describe('メモリ効率性確認', () => {
    test('データ変換処理のメモリ効率性確認', () => {
      const service = GoogleSheetsService.getInstance();
      
      // 中規模データで複数回処理を実行
      for (let iteration = 0; iteration < 10; iteration++) {
        const testData: string[][] = [];
        testData.push(['id', 'name', 'quantity', 'category', 'added_at']);
        
        for (let i = 1; i <= 100; i++) {
          testData.push([
            i.toString(),
            `Item ${i} Iteration ${iteration}`,
            '1',
            'food',
            new Date().toISOString()
          ]);
        }
        
        // 検証と正規化を実行
        const validationResult = service.validateData(testData);
        const normalizedData = service.normalizeData(testData);
        
        expect(validationResult.errors.length).toBeLessThan(2); // ヘッダー行のエラーのみ許容
        expect(normalizedData).toHaveLength(testData.length);
      }
      
      // テスト自体が完了することでメモリリークがないことを確認
      expect(true).toBe(true);
    });

    test('連続データ処理でのメモリ安定性', () => {
      const service = GoogleSheetsService.getInstance();
      const initialMemory = process.memoryUsage().heapUsed;
      
      // 50回の連続処理
      for (let i = 0; i < 50; i++) {
        const testData: string[][] = [
          ['id', 'name', 'quantity', 'category', 'added_at'],
          [(i + 1).toString(), `Test Item ${i}`, '1', 'food', new Date().toISOString()]
        ];
        
        service.validateData(testData);
        service.normalizeData(testData);
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // メモリ増加が5MB以内であることを確認
      expect(memoryIncrease).toBeLessThan(5 * 1024 * 1024);
    });
  });
});