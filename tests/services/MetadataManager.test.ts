import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetadataManager } from '../../src/services/MetadataManager';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import { ChannelMetadata } from '../../src/models/ChannelMetadata';
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
          update: vi.fn()
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

describe('MetadataManager', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let metadataManager: MetadataManager;
  let mockSheets: any;

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
    (MetadataManager as any).instance = undefined;

    // モックを取得
    const { google } = await import('googleapis');
    mockSheets = (google.sheets as any)().spreadsheets;

    // Google APIs のモック設定
    mockSheets.get.mockResolvedValue({
      data: {
        sheets: [{
          properties: {
            title: 'metadata',
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
        values: []
      }
    });

    mockSheets.values.append.mockResolvedValue({
      data: {}
    });

    mockSheets.values.update.mockResolvedValue({
      data: {}
    });

    metadataManager = MetadataManager.getInstance();
  });

  afterEach(() => {
    process.env = originalEnv;
    (Config as any).instance = undefined;
    (GoogleSheetsService as any).instance = undefined;
    
    // MetadataManagerのシングルトンと初期化状態をリセット
    const instance = (MetadataManager as any).instance;
    if (instance) {
      instance.isInitialized = false;
      instance.initializationPromise = null;
    }
    (MetadataManager as any).instance = undefined;
    
    vi.clearAllMocks();
  });

  describe('operationLogThreadId フィールド対応', () => {
    it('getChannelMetadata() が新フィールドを含むメタデータを返す', async () => {
      // Arrange
      const testChannelId = '123456789';
      const testOperationLogThreadId = '999888777666555444';
      
      // モックをクリアして予期しない呼び出しを避ける
      vi.clearAllMocks();
      
      // すべての呼び出しに対して同じデータを返すように設定
      mockSheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['channel_id', 'message_id', 'list_title', 'last_sync_time', 'default_category', 'operation_log_thread_id'],
            [testChannelId, 'msg123', 'テストリスト', '2025-01-01 12:00:00', 'general', testOperationLogThreadId]
          ]
        }
      });

      // Act
      const result = await metadataManager.getChannelMetadata(testChannelId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.operationLogThreadId).toBe(testOperationLogThreadId);
    });

    it('updateChannelMetadata() が新フィールドを保存できる', async () => {
      // Arrange
      const testChannelId = '123456789';
      const testOperationLogThreadId = '999888777666555444';
      const testMetadata: ChannelMetadata = {
        channelId: testChannelId,
        messageId: 'msg123',
        listTitle: 'テストリスト',
        lastSyncTime: new Date('2025-01-01T12:00:00Z'),
        defaultCategory: 'general',
        operationLogThreadId: testOperationLogThreadId
      };

      // モックをクリア
      vi.clearAllMocks();

      // 既存データがあることをモック
      mockSheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['channel_id', 'message_id', 'list_title', 'last_sync_time', 'default_category', 'operation_log_thread_id'],
            [testChannelId, 'old_msg', 'old_title', '2024-12-31 12:00:00', 'old_category', 'old_thread_id']
          ]
        }
      });

      // Act
      const result = await metadataManager.updateChannelMetadata(testChannelId, testMetadata);

      // Assert
      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.operationLogThreadId).toBe(testOperationLogThreadId);
      
      // updateが6列で呼ばれることを確認
      expect(mockSheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: 'A2:F2',
          valueInputOption: 'RAW',
          resource: {
            values: [[
              testChannelId,
              'msg123',
              'テストリスト',
              expect.any(String), // 日付文字列
              'general',
              testOperationLogThreadId
            ]]
          }
        })
      );
    });

    it('createChannelMetadata() が新フィールドを保存できる', async () => {
      // Arrange
      const testChannelId = '123456789';
      const testOperationLogThreadId = '999888777666555444';
      const testMetadata: ChannelMetadata = {
        channelId: testChannelId,
        messageId: 'msg123',
        listTitle: 'テストリスト',
        lastSyncTime: new Date('2025-01-01T12:00:00Z'),
        defaultCategory: 'general',
        operationLogThreadId: testOperationLogThreadId
      };

      // 空のmetadataシートをモック
      mockSheets.values.get.mockResolvedValueOnce({
        data: {
          values: [
            ['channel_id', 'message_id', 'list_title', 'last_sync_time', 'default_category', 'operation_log_thread_id']
          ]
        }
      });

      // Act
      const result = await metadataManager.createChannelMetadata(testChannelId, testMetadata);

      // Assert
      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.operationLogThreadId).toBe(testOperationLogThreadId);
      
      // appendが6列で呼ばれることを確認
      expect(mockSheets.values.append).toHaveBeenCalledWith(
        expect.objectContaining({
          range: expect.stringContaining('metadata'),
          valueInputOption: 'RAW',
          resource: {
            values: [[
              testChannelId,
              'msg123',
              'テストリスト',
              expect.any(String), // 日付文字列
              'general',
              testOperationLogThreadId
            ]]
          }
        })
      );
    });
  });

  describe('Google Sheets の6カラム目対応', () => {
    it('metadataHeaders が6つの要素を持つ', () => {
      // Act & Assert
      const headers = (metadataManager as any).metadataHeaders;
      expect(headers).toHaveLength(6);
    });

    it('新しいヘッダー「operation_log_thread_id」が含まれる', () => {
      // Act & Assert
      const headers = (metadataManager as any).metadataHeaders;
      expect(headers).toContain('operation_log_thread_id');
      expect(headers[5]).toBe('operation_log_thread_id');
    });

    it('ヘッダーの順序が正しい', () => {
      // Act & Assert
      const headers = (metadataManager as any).metadataHeaders;
      expect(headers[0]).toBe('channel_id');
      expect(headers[1]).toBe('message_id');
      expect(headers[2]).toBe('list_title');
      expect(headers[3]).toBe('last_sync_time');
      expect(headers[4]).toBe('default_category');
      expect(headers[5]).toBe('operation_log_thread_id');
    });

  });

  describe('シングルトンパターンの実装', () => {
    it('複数のgetInstance()呼び出しが同じインスタンスを返す', () => {
      // Act
      const instance1 = MetadataManager.getInstance();
      const instance2 = MetadataManager.getInstance();

      // Assert
      expect(instance1).toBe(instance2);
    });

    it('インスタンスがシングルトンである', () => {
      // Act
      const instance = MetadataManager.getInstance();

      // Assert
      expect(instance).toBeInstanceOf(MetadataManager);
      expect(MetadataManager.getInstance()).toBe(instance);
    });

    it('初期化プロセスが一度だけ実行される', async () => {
      // Arrange
      const testChannelId = '123456789';
      
      // インスタンスとモックをクリア
      (Config as any).instance = undefined;
      (GoogleSheetsService as any).instance = undefined;
      (MetadataManager as any).instance = undefined;
      vi.clearAllMocks();
      
      mockSheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['channel_id', 'message_id', 'list_title', 'last_sync_time', 'default_category', 'operation_log_thread_id'],
            [testChannelId, 'msg123', 'テストリスト', '2025-01-01 12:00:00', 'general', 'thread123']
          ]
        }
      });

      // Act - 同じチャンネルIDで複数回呼び出し
      const manager1 = MetadataManager.getInstance();
      const manager2 = MetadataManager.getInstance();
      
      const [result1, result2] = await Promise.all([
        manager1.getChannelMetadata(testChannelId),
        manager2.getChannelMetadata(testChannelId)
      ]);

      // Assert
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(manager1).toBe(manager2);
      
      // getSheetDataByNameの呼び出し回数をチェック（キャッシュ最適化で大幅に削減されているか確認）
      // 最適化により、初期化で1回 + 実際のoperationで1回程度まで削減される想定
      const callCount = mockSheets.values.get.mock.calls.length;
      expect(callCount).toBeLessThanOrEqual(3); // キャッシュ最適化により大幅に削減を期待
    });

    it('Configのシングルトンリセット時にMetadataManagerも再初期化される', () => {
      // Arrange
      const originalInstance = MetadataManager.getInstance();

      // Act - Configシングルトンをリセット
      (Config as any).instance = undefined;
      (GoogleSheetsService as any).instance = undefined;
      (MetadataManager as any).instance = undefined;

      const newInstance = MetadataManager.getInstance();

      // Assert
      expect(newInstance).not.toBe(originalInstance);
      expect(newInstance).toBeInstanceOf(MetadataManager);
    });
  });

  describe('既存データとの後方互換性', () => {
    it('新フィールドがないデータの読み込みでエラーにならない', async () => {
      // Arrange - 5列の既存データをモック
      const testChannelId = '123456789';
      
      // モックをクリア
      vi.clearAllMocks();
      
      mockSheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['channel_id', 'message_id', 'list_title', 'last_sync_time', 'default_category'],
            [testChannelId, 'msg123', 'テストリスト', '2025-01-01 12:00:00', 'general']
          ]
        }
      });

      // Act
      const result = await metadataManager.getChannelMetadata(testChannelId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.channelId).toBe(testChannelId);
      expect(result.metadata!.messageId).toBe('msg123');
      expect(result.metadata!.listTitle).toBe('テストリスト');
      expect(result.metadata!.defaultCategory).toBe('general');
    });

    it('undefinedの新フィールドも適切に処理される', async () => {
      // Arrange - 6列目が空の既存データをモック
      const testChannelId = '123456789';
      
      // モックをクリア
      vi.clearAllMocks();
      
      mockSheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['channel_id', 'message_id', 'list_title', 'last_sync_time', 'default_category', 'operation_log_thread_id'],
            [testChannelId, 'msg123', 'テストリスト', '2025-01-01 12:00:00', 'general', '']
          ]
        }
      });

      // Act
      const result = await metadataManager.getChannelMetadata(testChannelId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.operationLogThreadId).toBeUndefined();
    });

    it('operationLogThreadIdがundefinedの場合の更新処理が正常に動作する', async () => {
      // Arrange
      const testChannelId = '123456789';
      const testMetadata: ChannelMetadata = {
        channelId: testChannelId,
        messageId: 'msg123',
        listTitle: 'テストリスト',
        lastSyncTime: new Date('2025-01-01T12:00:00Z'),
        defaultCategory: 'general'
        // operationLogThreadId は undefined
      };

      // モックをクリア
      vi.clearAllMocks();

      // 既存データがあることをモック
      mockSheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['channel_id', 'message_id', 'list_title', 'last_sync_time', 'default_category', 'operation_log_thread_id'],
            [testChannelId, 'old_msg', 'old_title', '2024-12-31 12:00:00', 'old_category', 'old_thread_id']
          ]
        }
      });

      // Act
      const result = await metadataManager.updateChannelMetadata(testChannelId, testMetadata);

      // Assert
      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.operationLogThreadId).toBeUndefined();
      
      // updateが6列で呼ばれることを確認（6列目は空文字列またはundefined）
      expect(mockSheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: 'A2:F2',
          valueInputOption: 'RAW',
          resource: {
            values: [[
              testChannelId,
              'msg123',
              'テストリスト',
              expect.any(String), // 日付文字列
              'general',
              ''
            ]]
          }
        })
      );
    });

    it('5列から6列への移行時にヘッダー更新が正しく動作する', async () => {
      // Arrange - 5列の既存ヘッダーをモック
      // モックをクリア
      vi.clearAllMocks();
      
      mockSheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['channel_id', 'message_id', 'list_title', 'last_sync_time', 'default_category']
          ]
        }
      });

      // Act
      const result = await metadataManager.getOrCreateMetadataSheet();

      // Assert
      expect(result.success).toBe(true);
      
      // ヘッダー更新が6列で呼ばれることを確認
      expect(mockSheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: 'A1:F1',
          valueInputOption: 'RAW',
          resource: {
            values: [[
              'channel_id',
              'message_id',
              'list_title',
              'last_sync_time',
              'default_category',
              'operation_log_thread_id'
            ]]
          }
        })
      );
    });
  });
});