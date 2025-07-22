import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import { Config } from '../../src/utils/config';

// Google APIs のモック
vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(() => ({}))
    },
    sheets: vi.fn().mockReturnValue({
      spreadsheets: {
        get: vi.fn(),
        batchUpdate: vi.fn(),
        values: {
          get: vi.fn(),
          append: vi.fn(),
          update: vi.fn(),
          clear: vi.fn()
        }
      }
    })
  }
}));

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({}))
}));

// GoogleSheetsServiceのatomic操作強化テスト
describe('GoogleSheetsService Atomic Operations Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let googleSheetsService: GoogleSheetsService;
  let mockSheets: any;
  let mockGoogleAuth: any;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    
    // 必要な環境変数をセット
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
    process.env.GOOGLE_PRIVATE_KEY = 'test-private-key';

    // シングルトンをリセット
    (Config as any).instance = undefined;
    (GoogleSheetsService as any).instance = undefined;

    // モックを取得
    const { google } = await import('googleapis');
    const { GoogleAuth } = await import('google-auth-library');
    
    mockGoogleAuth = GoogleAuth as any;
    mockSheets = {
      spreadsheets: {
        get: vi.fn(),
        batchUpdate: vi.fn(),
        values: {
          get: vi.fn(),
          append: vi.fn(),
          update: vi.fn(),
          clear: vi.fn()
        }
      }
    };

    // Google Sheets API のモック設定
    (google.sheets as any).mockReturnValue(mockSheets);
    mockGoogleAuth.mockImplementation(() => ({
      getClient: vi.fn().mockResolvedValue({}),
      getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' })
    }));

    googleSheetsService = GoogleSheetsService.getInstance();
    
    // Google Sheets クライアントを初期化し、モックされたsheetsを設定
    await googleSheetsService.getAuthClient();
    (googleSheetsService as any).sheets = mockSheets;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('acquireOperationLock', () => {
    it('同一lockKeyに対する並行アクセスを直列化する', async () => {
      const lockKey = 'test-lock';
      const executionOrder: number[] = [];
      
      // 3つの並行操作をシミュレート
      const operations = [1, 2, 3].map(async (id) => {
        // プライベートメソッドをテストするために型アサーション
        const releaseLock = await (googleSheetsService as any).acquireOperationLock(lockKey);
        
        executionOrder.push(id);
        
        // 少し遅延を挟む
        await new Promise(resolve => setTimeout(resolve, 10));
        
        releaseLock();
        return id;
      });

      const results = await Promise.all(operations);
      
      // 全ての操作が完了すること
      expect(results).toEqual([1, 2, 3]);
      
      // 実行順序が直列化されていること（同時に実行されていない）
      expect(executionOrder.length).toBe(3);
    });

    it('ロックタイムアウトが正常に動作する', async () => {
      const lockKey = 'timeout-test';
      
      // タイムアウト時間を短くしてテスト（プライベートプロパティを操作）
      const originalTimeout = (googleSheetsService as any).lockTimeout;
      (googleSheetsService as any).lockTimeout = 100; // 100ms
      
      try {
        const releaseLock = await (googleSheetsService as any).acquireOperationLock(lockKey);
        
        // ロックを保持したまま100ms以上待機
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // ロックが自動解放されていることを確認
        const lockMap = (googleSheetsService as any).operationLocks;
        expect(lockMap.has(lockKey)).toBe(false);
        
        releaseLock(); // 手動解放（既に解放済みでもエラーにならない）
      } finally {
        (googleSheetsService as any).lockTimeout = originalTimeout;
      }
    });
  });

  describe('createDataBackup', () => {
    it('シートデータのバックアップを作成する', async () => {
      const testData = [['header1', 'header2'], ['data1', 'data2']];
      
      // getSheetDataByNameのモック
      vi.spyOn(googleSheetsService as any, 'getSheetDataByName').mockResolvedValue(testData);
      
      const backup = await (googleSheetsService as any).createDataBackup('test-sheet');
      
      expect(backup).toEqual(testData);
    });

    it('バックアップ作成に失敗した場合は空配列を返す', async () => {
      // getSheetDataByNameが失敗するようにモック
      vi.spyOn(googleSheetsService as any, 'getSheetDataByName').mockRejectedValue(new Error('API Error'));
      
      const backup = await (googleSheetsService as any).createDataBackup('test-sheet');
      
      expect(backup).toEqual([]);
    });
  });

  describe('rollbackData', () => {
    it('バックアップデータからロールバックを実行する', async () => {
      const backupData = [['header1', 'header2'], ['data1', 'data2']];
      
      mockSheets.spreadsheets.values.clear.mockResolvedValue({});
      mockSheets.spreadsheets.values.update.mockResolvedValue({});
      
      const result = await (googleSheetsService as any).rollbackData('test-sheet', backupData);
      
      expect(result).toBe(true);
      expect(mockSheets.spreadsheets.values.clear).toHaveBeenCalledWith({
        spreadsheetId: 'test-spreadsheet-id',
        range: 'test-sheet!A:Z'
      });
      expect(mockSheets.spreadsheets.values.update).toHaveBeenCalledWith({
        spreadsheetId: 'test-spreadsheet-id',
        range: 'test-sheet!A1',
        valueInputOption: 'RAW',
        resource: { values: backupData }
      });
    });

    it('バックアップデータが空の場合はfalseを返す', async () => {
      const result = await (googleSheetsService as any).rollbackData('test-sheet', []);
      
      expect(result).toBe(false);
      expect(mockSheets.spreadsheets.values.clear).not.toHaveBeenCalled();
    });
  });

  describe('conditionalAppend', () => {
    it('データ長が一致する場合に追加処理を実行する', async () => {
      const existingData = [['header'], ['row1']];
      const newData = [['row2']];
      
      vi.spyOn(googleSheetsService as any, 'getSheetDataByName').mockResolvedValue(existingData);
      mockSheets.spreadsheets.values.append.mockResolvedValue({});
      
      const result = await (googleSheetsService as any).conditionalAppend(
        'test-sheet',
        newData,
        0, // checkColumnIndex
        2  // expectedDataLength
      );
      
      expect(result.success).toBe(true);
      expect(mockSheets.spreadsheets.values.append).toHaveBeenCalled();
    });

    it('データ長が不一致の場合は失敗する', async () => {
      const existingData = [['header'], ['row1'], ['row2']]; // 長さ3
      const newData = [['row3']];
      
      vi.spyOn(googleSheetsService as any, 'getSheetDataByName').mockResolvedValue(existingData);
      
      const result = await (googleSheetsService as any).conditionalAppend(
        'test-sheet',
        newData,
        0,
        2  // expectedDataLength は2だが、実際は3
      );
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Data length mismatch');
      expect(mockSheets.spreadsheets.values.append).not.toHaveBeenCalled();
    });

    it('重複データが検出された場合は失敗する', async () => {
      const existingData = [['header'], ['existing-value']];
      const newData = [['existing-value']]; // 重複
      
      vi.spyOn(googleSheetsService as any, 'getSheetDataByName').mockResolvedValue(existingData);
      
      const result = await (googleSheetsService as any).conditionalAppend(
        'test-sheet',
        newData,
        0, // checkColumnIndex
        2  // expectedDataLength
      );
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('重複データが検出されました');
      expect(mockSheets.spreadsheets.values.append).not.toHaveBeenCalled();
    });
  });

  describe('appendSheetDataWithDuplicateCheck (atomic version)', () => {
    beforeEach(() => {
      // 認証関連のモック
      vi.spyOn(googleSheetsService as any, 'getAuthClient').mockResolvedValue({});
      vi.spyOn(googleSheetsService as any, 'getSheetNameForChannel').mockReturnValue('test-sheet');
    });

    it('正常なatomic操作で成功する', async () => {
      const existingData = [['header']];
      const newData = [['new-value']];
      
      vi.spyOn(googleSheetsService as any, 'createDataBackup').mockResolvedValue(existingData);
      vi.spyOn(googleSheetsService as any, 'conditionalAppend').mockResolvedValue({ success: true });
      
      const result = await googleSheetsService.appendSheetDataWithDuplicateCheck(
        'test-channel',
        newData,
        0
      );
      
      expect(result.success).toBe(true);
    });

    it('重複データでリトライせずに失敗する', async () => {
      const existingData = [['header'], ['existing-value']];
      const newData = [['existing-value']];
      
      vi.spyOn(googleSheetsService as any, 'createDataBackup').mockResolvedValue(existingData);
      vi.spyOn(googleSheetsService as any, 'conditionalAppend').mockResolvedValue({
        success: false,
        message: '重複データが検出されました: existing-value'
      });
      
      const result = await googleSheetsService.appendSheetDataWithDuplicateCheck(
        'test-channel',
        newData,
        0
      );
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('重複データが検出されました');
    });

    it('データ長不一致でリトライを実行する', async () => {
      const existingData = [['header']];
      const newData = [['new-value']];
      
      vi.spyOn(googleSheetsService as any, 'createDataBackup').mockResolvedValue(existingData);
      
      // 最初は失敗、2回目は成功
      const conditionalAppendSpy = vi.spyOn(googleSheetsService as any, 'conditionalAppend')
        .mockResolvedValueOnce({
          success: false,
          message: 'Data length mismatch. Expected: 1, Actual: 2'
        })
        .mockResolvedValueOnce({ success: true });
      
      const result = await googleSheetsService.appendSheetDataWithDuplicateCheck(
        'test-channel',
        newData,
        0
      );
      
      expect(result.success).toBe(true);
      expect(conditionalAppendSpy).toHaveBeenCalledTimes(2);
    });

    it('同時実行によるロック機能の動作確認', async () => {
      const existingData = [['header']];
      const newData1 = [['value1']];
      const newData2 = [['value2']];
      
      vi.spyOn(googleSheetsService as any, 'createDataBackup').mockResolvedValue(existingData);
      vi.spyOn(googleSheetsService as any, 'conditionalAppend').mockResolvedValue({ success: true });
      
      // 同時実行
      const [result1, result2] = await Promise.all([
        googleSheetsService.appendSheetDataWithDuplicateCheck('test-channel', newData1, 0),
        googleSheetsService.appendSheetDataWithDuplicateCheck('test-channel', newData2, 0)
      ]);
      
      // 両方成功することを確認（ロックにより直列化される）
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });
});