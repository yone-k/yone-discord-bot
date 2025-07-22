import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import { InitListCommand } from '../../src/commands/InitListCommand';
import { Logger } from '../../src/utils/logger';
import { ChannelSheetManager } from '../../src/services/ChannelSheetManager';
import { MessageManager } from '../../src/services/MessageManager';
import { MetadataManager } from '../../src/services/MetadataManager';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';

// MetadataManagerクラスをモック
vi.mock('../../src/services/MetadataManager', () => {
  return {
    MetadataManager: vi.fn().mockImplementation(() => ({
      createChannelMetadata: vi.fn().mockResolvedValue({ success: true }),
      updateChannelMetadata: vi.fn().mockResolvedValue({ success: true }),
      getChannelMetadata: vi.fn().mockResolvedValue(null)
    }))
  };
});

// Mock classes
class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

class MockChannelSheetManager {
  getOrCreateChannelSheet = vi.fn().mockResolvedValue({
    success: true,
    existed: false,
    created: true
  });
}

class MockMessageManager {
  createOrUpdateMessageWithMetadata = vi.fn().mockResolvedValue({
    success: true,
    message: { id: 'test-message-id' }
  });
}

class MockMetadataManager {
  // No methods needed for performance tests
}

describe('Performance Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockLogger: MockLogger;
  let mockChannelSheetManager: MockChannelSheetManager;
  let mockMessageManager: MockMessageManager;
  let mockMetadataManager: MockMetadataManager;
  let mockGoogleSheetsService: GoogleSheetsService;
  let command: InitListCommand;
  let mockContext: CommandExecutionContext;

  beforeEach(() => {
    originalEnv = { ...process.env };
    
    // Discord設定
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
    
    // Google Sheets設定
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.com';
    process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\ntest-key\\n-----END PRIVATE KEY-----';

    mockLogger = new MockLogger();
    mockChannelSheetManager = new MockChannelSheetManager();
    mockMessageManager = new MockMessageManager();
    mockMetadataManager = new MockMetadataManager();

    // 実際のGoogleSheetsServiceをモック
    const mockGoogleSheetsServicePrototype = {
      checkSpreadsheetExists: vi.fn().mockResolvedValue(true),
      getSheetData: vi.fn(),
      validateData: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
      normalizeData: vi.fn()
    };

    mockGoogleSheetsService = mockGoogleSheetsServicePrototype as unknown as GoogleSheetsService;

    // GoogleSheetsService.getInstance をモック
    vi.spyOn(GoogleSheetsService, 'getInstance').mockReturnValue(mockGoogleSheetsService);

    command = new InitListCommand(
      mockLogger as unknown as Logger,
      mockChannelSheetManager as unknown as ChannelSheetManager,
      mockMessageManager as unknown as MessageManager,
      mockMetadataManager as unknown as MetadataManager,
      mockGoogleSheetsService
    );
    
    // useThreadをfalseに設定してスレッド機能を無効化
    (command as any).useThread = false;

    mockContext = {
      userId: 'test-user-id',
      guildId: 'test-guild-id',
      channelId: 'test-channel-id',
      interaction: {
        editReply: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
        client: {} as any
      } as any
    };
    
    // 追加のモック設定
    mockContext.interaction.reply = vi.fn().mockImplementation((options) => {
      if (typeof options === 'object' && options.content) {
        return Promise.resolve({ id: 'test-message-id' });
      }
      return Promise.resolve({ id: 'test-message-id' });
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('大量データ処理時のパフォーマンス確認', () => {
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
          ['primary', 'secondary', 'other'][i % 3],
          new Date(Date.now() - Math.random() * 86400000 * 30).toISOString()
        ]);
      }
      
      return data;
    }

    test('100件のデータ処理パフォーマンス（2秒以内）', async () => {
      const startTime = Date.now();
      const largeData = generateLargeDataset(100);
      
      (mockGoogleSheetsService.getSheetData as any).mockResolvedValue(largeData);
      (mockGoogleSheetsService.normalizeData as any).mockReturnValue(largeData);

      await command.execute(mockContext);

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      expect(executionTime).toBeLessThan(2000); // 2秒以内
      expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalled();
      expect(mockContext.interaction?.editReply).toHaveBeenCalledWith({
        content: '✅ スプレッドシートから100件のアイテムを取得し、このチャンネルに表示しました'
      });
    });


    test('不正なデータが混在する場合のパフォーマンス', async () => {
      const startTime = Date.now();
      
      // 不正なデータが混在する大規模データセット
      const mixedData = generateLargeDataset(200);
      
      // 一部のデータを不正にする
      for (let i = 10; i < mixedData.length; i += 10) {
        mixedData[i] = ['', 'invalid']; // 不完全なデータ
      }
      
      (mockGoogleSheetsService.getSheetData as any).mockResolvedValue(mixedData);
      (mockGoogleSheetsService.normalizeData as any).mockReturnValue(mixedData);
      (mockGoogleSheetsService.validateData as any).mockReturnValue({
        isValid: false,
        errors: ['行 10: 必要な列数が不足しています', '行 20: 必要な列数が不足しています']
      });

      await expect(command.execute(mockContext)).rejects.toThrow('List initialization failed');

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      expect(executionTime).toBeLessThan(3000); // 3秒以内
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Data validation warnings',
        expect.objectContaining({
          channelId: 'test-channel-id'
        })
      );
    });
  });

  describe('メモリ使用量の確認', () => {
    test('大量データ処理後のメモリリーク確認', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // 複数回の大量データ処理を実行
      for (let i = 0; i < 5; i++) {
        const largeData = generateLargeDataset(100);
        (mockGoogleSheetsService.getSheetData as any).mockResolvedValue(largeData);
        (mockGoogleSheetsService.normalizeData as any).mockReturnValue(largeData);
        
        await command.execute(mockContext);
        
        // ガベージコレクションを促進
        if (global.gc) {
          global.gc();
        }
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // メモリ増加が50MB以内であることを確認（目安）
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    function generateLargeDataset(size: number): string[][] {
      const data: string[][] = [];
      data.push(['id', 'name', 'quantity', 'category', 'added_at']);
      
      for (let i = 1; i <= size; i++) {
        data.push([
          i.toString(),
          `Item ${i}`,
          '1',
          'primary',
          new Date().toISOString()
        ]);
      }
      
      return data;
    }
  });

  describe('並行処理パフォーマンス', () => {
    test('複数チャンネルでの同時実行パフォーマンス', async () => {
      const startTime = Date.now();
      
      // 異なるチャンネルIDでの同時実行
      const contexts = [
        { ...mockContext, channelId: 'channel-1' },
        { ...mockContext, channelId: 'channel-2' },
        { ...mockContext, channelId: 'channel-3' }
      ];

      const testData = generateLargeDataset(50);
      (mockGoogleSheetsService.getSheetData as any).mockResolvedValue(testData);
      (mockGoogleSheetsService.normalizeData as any).mockReturnValue(testData);

      // 並行実行
      const promises = contexts.map(ctx => command.execute(ctx));
      await Promise.all(promises);

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      expect(executionTime).toBeLessThan(3000); // 3秒以内で完了
      expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalledTimes(3);
    });

    function generateLargeDataset(size: number): string[][] {
      const data: string[][] = [];
      data.push(['id', 'name', 'quantity', 'category', 'added_at']);
      
      for (let i = 1; i <= size; i++) {
        data.push([
          i.toString(),
          `Item ${i}`,
          '1',
          'primary',
          new Date().toISOString()
        ]);
      }
      
      return data;
    }
  });
});