import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { InitListCommand } from '../../src/commands/InitListCommand';
import { CommandError, CommandErrorType } from '../../src/utils/CommandError';
import { Logger } from '../../src/utils/logger';
import { ChannelSheetManager } from '../../src/services/ChannelSheetManager';
import { MessageManager } from '../../src/services/MessageManager';
import { MetadataManager } from '../../src/services/MetadataManager';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';

// Mock classes
class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

class MockChannelSheetManager {
  getOrCreateChannelSheet = vi.fn();
}

class MockMessageManager {
  createOrUpdateMessageWithMetadata = vi.fn();
}

class MockMetadataManager {
  // No methods needed for permission tests
}

class MockGoogleSheetsService {
  checkSpreadsheetExists = vi.fn();
  getSheetData = vi.fn();
  validateData = vi.fn();
  normalizeData = vi.fn();
}

describe('InitListCommand Permission Error Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let command: InitListCommand;
  let mockLogger: MockLogger;
  let mockChannelSheetManager: MockChannelSheetManager;
  let mockMessageManager: MockMessageManager;
  let mockMetadataManager: MockMetadataManager;
  let mockGoogleSheetsService: MockGoogleSheetsService;
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

    // Reset singletons
    (GoogleSheetsService as any).instance = undefined;

    mockLogger = new MockLogger();
    mockChannelSheetManager = new MockChannelSheetManager();
    mockMessageManager = new MockMessageManager();
    mockMetadataManager = new MockMetadataManager();
    mockGoogleSheetsService = new MockGoogleSheetsService();

    command = new InitListCommand(
      mockLogger as unknown as Logger,
      mockChannelSheetManager as unknown as ChannelSheetManager,
      mockMessageManager as unknown as MessageManager,
      mockMetadataManager as unknown as MetadataManager,
      mockGoogleSheetsService as unknown as GoogleSheetsService
    );

    mockContext = {
      userId: 'test-user-id',
      guildId: 'test-guild-id',
      channelId: 'test-channel-id',
      interaction: {
        deferReply: vi.fn(),
        editReply: vi.fn(),
        reply: vi.fn(),
        client: {} as any,
        options: {
          getString: vi.fn().mockReturnValue(null),
          getBoolean: vi.fn().mockReturnValue(true) // enable-logオプションのデフォルト値
        }
      } as any
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('権限不足時のエラー表示確認', () => {
    test('スプレッドシートアクセス権限不足でPERMISSION_DENIEDエラー', async () => {
      // スプレッドシートアクセスが失敗する設定
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(false);

      await expect(command.execute(mockContext)).rejects.toThrow(CommandError);

      try {
        await command.execute(mockContext);
      } catch (error) {
        const cmdError = error as CommandError;
        expect(cmdError.type).toBe(CommandErrorType.PERMISSION_DENIED);
        expect(cmdError.userMessage).toBe('スプレッドシートへのアクセス権限がありません。');
        expect(cmdError.commandName).toBe('init-list');
      }

      expect(mockGoogleSheetsService.checkSpreadsheetExists).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('スプレッドシートアクセス確認中の例外でPERMISSION_DENIEDエラー', async () => {
      // アクセス確認中に例外が発生する設定
      mockGoogleSheetsService.checkSpreadsheetExists.mockRejectedValue(
        new Error('Authentication failed')
      );

      await expect(command.execute(mockContext)).rejects.toThrow(CommandError);

      try {
        await command.execute(mockContext);
      } catch (error) {
        const cmdError = error as CommandError;
        expect(cmdError.type).toBe(CommandErrorType.PERMISSION_DENIED);
        expect(cmdError.userMessage).toBe('スプレッドシートへのアクセス確認に失敗しました。');
        expect(cmdError.commandName).toBe('init-list');
        expect(cmdError.message).toContain('Authentication failed');
      }

      expect(mockGoogleSheetsService.checkSpreadsheetExists).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('チャンネルID未設定でINVALID_PARAMETERSエラー', async () => {
      const contextWithoutChannel = {
        ...mockContext,
        channelId: undefined
      };

      await expect(command.execute(contextWithoutChannel)).rejects.toThrow(CommandError);

      try {
        await command.execute(contextWithoutChannel);
      } catch (error) {
        const cmdError = error as CommandError;
        expect(cmdError.type).toBe(CommandErrorType.INVALID_PARAMETERS);
        expect(cmdError.userMessage).toBe('チャンネルIDが必要です。');
        expect(cmdError.commandName).toBe('init-list');
      }

      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('アクセス権限確認が成功する正常ケース', async () => {
      // 正常なアクセス権限確認
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue([]);
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
      mockGoogleSheetsService.normalizeData.mockReturnValue([]);
      
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        success: true,
        existed: false,
        created: true
      });
      
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        message: { id: 'test-message-id' }
      });

      // エラーが発生しないことを確認
      await expect(command.execute(mockContext)).resolves.not.toThrow();

      expect(mockGoogleSheetsService.checkSpreadsheetExists).toHaveBeenCalled();
      expect(mockContext.interaction?.editReply).toHaveBeenCalledWith({
        content: '✅ スプレッドシートから0件のアイテムを取得し、このチャンネルに表示しました'
      });
    });
  });

  describe('権限エラーのユーザーメッセージ確認', () => {
    test('各権限エラータイプのユーザーメッセージが適切', () => {
      const permissionError = new CommandError(
        CommandErrorType.PERMISSION_DENIED,
        'init-list',
        'Sheet access failed',
        'スプレッドシートへのアクセス権限がありません。'
      );

      expect(permissionError.userMessage).toBe('スプレッドシートへのアクセス権限がありません。');
      expect(permissionError.type).toBe(CommandErrorType.PERMISSION_DENIED);
      expect(permissionError.commandName).toBe('init-list');
    });

    test('パラメータエラーのユーザーメッセージが適切', () => {
      const paramError = new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'init-list',
        'Channel ID is required',
        'チャンネルIDが必要です。'
      );

      expect(paramError.userMessage).toBe('チャンネルIDが必要です。');
      expect(paramError.type).toBe(CommandErrorType.INVALID_PARAMETERS);
      expect(paramError.commandName).toBe('init-list');
    });
  });

  describe('エラーログ出力確認', () => {
    test('権限エラー発生時に適切なログが出力される', async () => {
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(false);

      try {
        await command.execute(mockContext);
      } catch (_error) {
        // エラーは期待通り
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Init list command failed',
        expect.objectContaining({
          userId: 'test-user-id',
          channelId: 'test-channel-id'
        })
      );
    });

    test('予期しないエラー発生時に汎用エラーメッセージが生成される', async () => {
      // checkSpreadsheetExistsは成功させ、MessageManagerでエラーを発生させる
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockMessageManager.createOrUpdateMessageWithMetadata.mockRejectedValue(new Error('Unexpected error'));

      await expect(command.execute(mockContext)).rejects.toThrow(CommandError);

      try {
        await command.execute(mockContext);
      } catch (error) {
        const cmdError = error as CommandError;
        expect(cmdError.type).toBe(CommandErrorType.EXECUTION_FAILED);
        expect(cmdError.userMessage).toBe('リストの初期化に失敗しました。しばらく時間を置いてから再試行してください。');
        expect(cmdError.message).toContain('Unexpected error');
      }

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});