import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleSheetsService, GoogleSheetsError } from '../../src/services/GoogleSheetsService';
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
          append: vi.fn()
        }
      }
    })
  }
}));

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getClient: vi.fn().mockResolvedValue({})
  }))
}));

describe('GoogleSheetsService', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockSheets: any;
  let mockGoogleAuth: any;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    
    // 必要な環境変数をセット
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
    process.env.GOOGLE_PRIVATE_KEY = 'test-private-key'

    // シングルトンをリセット
    ;(Config as any).instance = undefined
    ;(GoogleSheetsService as any).instance = undefined;

    // モックを取得
    const { google } = await import('googleapis');
    const { GoogleAuth } = await import('google-auth-library');
    
    mockGoogleAuth = GoogleAuth as any;
    mockSheets = (google.sheets as any)().spreadsheets;

    // GoogleAuthのモック設定
    mockGoogleAuth.mockImplementation(() => ({
      getClient: vi.fn().mockResolvedValue({})
    }));

    // Google APIs のモック設定
    mockSheets.get.mockResolvedValue({
      data: {
        sheets: [{
          properties: {
            title: 'list_123456789',
            sheetId: 123,
            gridProperties: {
              rowCount: 100,
              columnCount: 26
            }
          }
        }]
      }
    });

    mockSheets.batchUpdate.mockResolvedValue({
      data: {
        replies: [{
          addSheet: {
            properties: {
              sheetId: 123
            }
          }
        }]
      }
    });

    mockSheets.values.get.mockResolvedValue({
      data: {
        values: [['テスト項目', '説明', '2025-01-01']]
      }
    });

    mockSheets.values.append.mockResolvedValue({
      data: {}
    });
  });

  afterEach(() => {
    process.env = originalEnv
    ;(Config as any).instance = undefined
    ;(GoogleSheetsService as any).instance = undefined;
    vi.clearAllMocks();
  });

  describe('インスタンス生成', () => {
    it('Google Sheets設定が有効な場合、正常にインスタンスが作成される', () => {
      const service = GoogleSheetsService.getInstance();
      expect(service).toBeInstanceOf(GoogleSheetsService);
    });

    it('Google Sheets設定が未設定の場合、CONFIG_MISSINGエラーがスローされる', () => {
      delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      delete process.env.GOOGLE_PRIVATE_KEY
      ;(Config as any).instance = undefined
      ;(GoogleSheetsService as any).instance = undefined;

      expect(() => {
        GoogleSheetsService.getInstance();
      }).toThrow(GoogleSheetsError);
    });

    it('シングルトンパターンで同じインスタンスが返される', () => {
      const service1 = GoogleSheetsService.getInstance();
      const service2 = GoogleSheetsService.getInstance();
      expect(service1).toBe(service2);
    });
  });

  describe('Google認証', () => {
    it('サービスアカウント認証が正しく初期化される', async () => {
      const service = GoogleSheetsService.getInstance();
      const auth = await service.getAuthClient();
      expect(auth).toBeDefined();
    });

    it('認証に失敗した場合、AUTHENTICATION_FAILEDエラーがスローされる', async () => {
      // GoogleAuth コンストラクタがエラーをスローするようにモック
      mockGoogleAuth.mockImplementationOnce(() => {
        throw new Error('Authentication failed');
      });

      process.env.GOOGLE_PRIVATE_KEY = 'invalid-key'
      ;(Config as any).instance = undefined
      ;(GoogleSheetsService as any).instance = undefined;
      
      const service = GoogleSheetsService.getInstance();
      await expect(service.getAuthClient()).rejects.toThrow(GoogleSheetsError);
    });
  });

  describe('スプレッドシート操作', () => {
    it('スプレッドシートの存在確認ができる', async () => {
      const service = GoogleSheetsService.getInstance();
      const exists = await service.checkSpreadsheetExists();
      expect(typeof exists).toBe('boolean');
    });

    it('チャンネル別シートの命名規則が正しい', () => {
      const service = GoogleSheetsService.getInstance();
      const channelId = '123456789';
      const sheetName = service.getSheetNameForChannel(channelId);
      expect(sheetName).toBe('list_123456789');
    });

    it('チャンネル別シートを作成できる', async () => {
      const service = GoogleSheetsService.getInstance();
      const channelId = '123456789';
      const result = await service.createChannelSheet(channelId);
      expect(result.success).toBe(true);
      expect(result.sheetId).toBeDefined();
    });

    it('シートのデータを取得できる', async () => {
      const service = GoogleSheetsService.getInstance();
      const channelId = '123456789';
      const data = await service.getSheetData(channelId);
      expect(Array.isArray(data)).toBe(true);
    });

    it('シートにデータを追加できる', async () => {
      const service = GoogleSheetsService.getInstance();
      const channelId = '123456789';
      const testData = [['テスト項目', '説明', '2025-01-01']];
      const result = await service.appendSheetData(channelId, testData);
      expect(result.success).toBe(true);
    });
  });

  describe('データ検証と正規化', () => {
    it('有効なデータを検証できる', () => {
      const service = GoogleSheetsService.getInstance();
      const validData = [['項目名', '説明', '2025-01-01']];
      const result = service.validateData(validData);
      expect(result.isValid).toBe(true);
    });

    it('1列のみのデータも有効として検証できる', () => {
      const service = GoogleSheetsService.getInstance();
      const validData = [['項目名']];
      const result = service.validateData(validData);
      expect(result.isValid).toBe(true);
    });

    it('無効なデータを検出できる', () => {
      const service = GoogleSheetsService.getInstance();
      const invalidData = [['', '', 'invalid-date']];
      const result = service.validateData(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('空の行（0列）は無効として検出される', () => {
      const service = GoogleSheetsService.getInstance();
      const invalidData = [[]];
      const result = service.validateData(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('データを正規化できる', () => {
      const service = GoogleSheetsService.getInstance();
      const rawData = [['  項目名  ', '説明文', '2025/01/01']];
      const normalizedData = service.normalizeData(rawData);
      expect(normalizedData[0][0]).toBe('項目名');
      expect(normalizedData[0][2]).toBe('2025-01-01');
    });
  });

  describe('エラーハンドリングとリトライ', () => {
    it('レート制限エラーでリトライが実行される', async () => {
      const service = GoogleSheetsService.getInstance();
      const channelId = '123456789';
      
      // 最初はレート制限エラー、2回目は成功をモック
      let callCount = 0;
      mockSheets.values.get.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const error = new Error('Rate limit exceeded')
          ;(error as any).code = 429;
          throw error;
        }
        return Promise.resolve({
          data: {
            values: [['リトライ成功', '説明', '2025-01-01']]
          }
        });
      });

      const data = await service.getSheetData(channelId);
      expect(data).toEqual([['リトライ成功', '説明', '2025-01-01']]);
    });

    it('最大リトライ回数を超えた場合、エラーがスローされる', async () => {
      const service = GoogleSheetsService.getInstance();
      const channelId = '123456789';
      
      // 常にエラーをスロー
      mockSheets.values.get.mockRejectedValue(
        new Error('Persistent error')
      );

      await expect(service.getSheetData(channelId)).rejects.toThrow();
    });
  });

  describe('check列の0/1変換機能', () => {
    describe('データ読み込み時のcheck列変換', () => {
      it('スプレッドシートの"0"をboolean falseに変換する', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        
        // check列に"0"が含まれるデータをモック
        mockSheets.values.get.mockResolvedValueOnce({
          data: {
            values: [
              ['name', 'description', 'category', 'addedAt', 'until', 'check'],
              ['テスト項目', '説明', 'カテゴリ', '2025-01-01', '2025-01-31', '0']
            ]
          }
        });

        const data = await service.getSheetDataWithCheckColumn(channelId);
        expect(data[0].check).toBe(false);
      });

      it('スプレッドシートの"1"をboolean trueに変換する', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        
        // check列に"1"が含まれるデータをモック
        mockSheets.values.get.mockResolvedValueOnce({
          data: {
            values: [
              ['name', 'description', 'category', 'addedAt', 'until', 'check'],
              ['テスト項目', '説明', 'カテゴリ', '2025-01-01', '2025-01-31', '1']
            ]
          }
        });

        const data = await service.getSheetDataWithCheckColumn(channelId);
        expect(data[0].check).toBe(true);
      });

      it('check列が存在しない場合、デフォルト値（false）を設定する', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        
        // check列が含まれないデータをモック
        mockSheets.values.get.mockResolvedValueOnce({
          data: {
            values: [
              ['name', 'description', 'category', 'addedAt', 'until'],
              ['テスト項目', '説明', 'カテゴリ', '2025-01-01', '2025-01-31']
            ]
          }
        });

        const data = await service.getSheetDataWithCheckColumn(channelId);
        expect(data[0].check).toBe(false);
      });

      it('不正な値（0,1以外）の場合、デフォルト値（false）を設定する', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        
        // check列に不正な値が含まれるデータをモック
        mockSheets.values.get.mockResolvedValueOnce({
          data: {
            values: [
              ['name', 'description', 'category', 'addedAt', 'until', 'check'],
              ['テスト項目1', '説明', 'カテゴリ', '2025-01-01', '2025-01-31', 'invalid'],
              ['テスト項目2', '説明', 'カテゴリ', '2025-01-01', '2025-01-31', '2'],
              ['テスト項目3', '説明', 'カテゴリ', '2025-01-01', '2025-01-31', 'true']
            ]
          }
        });

        const data = await service.getSheetDataWithCheckColumn(channelId);
        expect(data[0].check).toBe(false);
        expect(data[1].check).toBe(false);
        expect(data[2].check).toBe(false);
      });

      it('複数行の混合データを正しく変換する', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        
        // 0と1が混在するデータをモック
        mockSheets.values.get.mockResolvedValueOnce({
          data: {
            values: [
              ['name', 'description', 'category', 'addedAt', 'until', 'check'],
              ['項目1', '説明1', 'カテゴリ', '2025-01-01', '2025-01-31', '0'],
              ['項目2', '説明2', 'カテゴリ', '2025-01-01', '2025-01-31', '1'],
              ['項目3', '説明3', 'カテゴリ', '2025-01-01', '2025-01-31', '0']
            ]
          }
        });

        const data = await service.getSheetDataWithCheckColumn(channelId);
        expect(data[0].check).toBe(false);
        expect(data[1].check).toBe(true);
        expect(data[2].check).toBe(false);
      });
    });

    describe('データ書き込み時のcheck列変換', () => {
      it('boolean trueを数値1に変換して書き込む', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        const itemData = {
          name: 'テスト項目',
          description: '説明',
          category: 'カテゴリ',
          addedAt: '2025-01-01',
          until: '2025-01-31',
          check: true
        };

        await service.appendItemWithCheckColumn(channelId, itemData);
        
        // appendが正しい形式で呼ばれたかを検証
        expect(mockSheets.values.append).toHaveBeenCalledWith(
          expect.objectContaining({
            range: expect.stringContaining('list_123456789'),
            valueInputOption: 'RAW',
            resource: {
              values: [['テスト項目', '説明', 'カテゴリ', '2025-01-01', '2025-01-31', 1]]
            }
          })
        );
      });

      it('boolean falseを数値0に変換して書き込む', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        const itemData = {
          name: 'テスト項目',
          description: '説明',
          category: 'カテゴリ',
          addedAt: '2025-01-01',
          until: '2025-01-31',
          check: false
        };

        await service.appendItemWithCheckColumn(channelId, itemData);
        
        // appendが正しい形式で呼ばれたかを検証
        expect(mockSheets.values.append).toHaveBeenCalledWith(
          expect.objectContaining({
            range: expect.stringContaining('list_123456789'),
            valueInputOption: 'RAW',
            resource: {
              values: [['テスト項目', '説明', 'カテゴリ', '2025-01-01', '2025-01-31', 0]]
            }
          })
        );
      });

      it('check列ヘッダーを自動追加する', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        
        // 既存のヘッダーにcheck列がない場合をモック
        mockSheets.values.get.mockResolvedValueOnce({
          data: {
            values: [
              ['name', 'description', 'category', 'addedAt', 'until']
            ]
          }
        });

        await service.ensureCheckColumnHeader(channelId);
        
        // ヘッダー行の更新が呼ばれたかを検証
        expect(mockSheets.values.append).toHaveBeenCalledWith(
          expect.objectContaining({
            range: expect.stringContaining('list_123456789!A1:F1'),
            valueInputOption: 'RAW',
            resource: {
              values: [['name', 'description', 'category', 'addedAt', 'until', 'check']]
            }
          })
        );
      });
    });

    describe('既存データ互換性', () => {
      it('check列が未定義の既存データを正しく読み込む', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        
        // check列なしの既存データをモック
        mockSheets.values.get.mockResolvedValueOnce({
          data: {
            values: [
              ['name', 'description', 'category', 'addedAt', 'until'],
              ['既存項目1', '説明1', 'カテゴリ', '2025-01-01', '2025-01-31'],
              ['既存項目2', '説明2', 'カテゴリ', '2025-01-01', '2025-01-31']
            ]
          }
        });

        const data = await service.getSheetDataWithCheckColumn(channelId);
        expect(data).toHaveLength(2);
        expect(data[0].check).toBe(false);
        expect(data[1].check).toBe(false);
        expect(data[0].name).toBe('既存項目1');
        expect(data[1].name).toBe('既存項目2');
      });

      it('既存データへのcheck列追加が正しく動作する', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        
        // 段階的にデータが更新される様子をモック
        mockSheets.values.get
          .mockResolvedValueOnce({
            // 最初: check列なし
            data: {
              values: [
                ['name', 'description', 'category', 'addedAt', 'until'],
                ['既存項目', '説明', 'カテゴリ', '2025-01-01', '2025-01-31']
              ]
            }
          })
          .mockResolvedValueOnce({
            // 後: check列追加後
            data: {
              values: [
                ['name', 'description', 'category', 'addedAt', 'until', 'check'],
                ['既存項目', '説明', 'カテゴリ', '2025-01-01', '2025-01-31', '0']
              ]
            }
          });

        // check列を追加
        await service.migrateToCheckColumn(channelId);
        
        // 既存データにcheck列が追加されていることを確認
        const data = await service.getSheetDataWithCheckColumn(channelId);
        expect(data[0].check).toBe(false);
        expect(data[0].name).toBe('既存項目');
      });

      it('check列を更新する', async () => {
        const service = GoogleSheetsService.getInstance();
        const channelId = '123456789';
        const rowIndex = 1; // 2行目のデータ（ヘッダーの次の行）
        const newCheckValue = true;

        await service.updateCheckColumn(channelId, rowIndex, newCheckValue);
        
        // 特定のセルの更新が呼ばれたかを検証
        expect(mockSheets.values.append).toHaveBeenCalledWith(
          expect.objectContaining({
            range: expect.stringContaining('list_123456789!F2:F2'),
            valueInputOption: 'RAW',
            resource: {
              values: [[1]]
            }
          })
        );
      });
    });
  });

  describe('メタデータ管理', () => {
    it('シートのメタデータを取得できる', async () => {
      const service = GoogleSheetsService.getInstance();
      const channelId = '123456789';
      const metadata = await service.getSheetMetadata(channelId);
      expect(metadata).toHaveProperty('title');
      expect(metadata).toHaveProperty('sheetId');
      expect(metadata).toHaveProperty('rowCount');
    });

    it('シートのメタデータを更新できる', async () => {
      const service = GoogleSheetsService.getInstance();
      const channelId = '123456789';
      const newTitle = '更新されたタイトル';
      const result = await service.updateSheetMetadata(channelId, { title: newTitle });
      expect(result.success).toBe(true);
    });
  });
});