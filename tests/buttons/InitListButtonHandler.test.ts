import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction } from 'discord.js';
import { Logger, LogLevel } from '../../src/utils/logger';
import { InitListButtonHandler } from '../../src/buttons/InitListButtonHandler';
import { InitListCommand } from '../../src/commands/InitListCommand';
import { ButtonHandlerContext } from '../../src/base/BaseButtonHandler';
import { OperationInfo } from '../../src/models/types/OperationLog';

// 環境変数のモック
process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
process.env.CLIENT_ID = 'test-client-id';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
process.env.GOOGLE_PRIVATE_KEY = 'test-private-key';
process.env.GOOGLE_SPREADSHEET_ID = 'test-spreadsheet-id';

// GoogleSheetsServiceのモック
vi.mock('../../src/services/GoogleSheetsService', () => ({
  GoogleSheetsService: {
    getInstance: vi.fn().mockReturnValue({
      getSheetData: vi.fn().mockResolvedValue([]),
      normalizeData: vi.fn().mockImplementation((data) => data),
      createChannelSheet: vi.fn().mockResolvedValue(true),
      validateData: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
      checkSpreadsheetExists: vi.fn().mockResolvedValue(true)
    })
  }
}));

// その他のサービスもモック
vi.mock('../../src/services/ChannelSheetManager', () => ({
  ChannelSheetManager: vi.fn().mockImplementation(() => ({
    getOrCreateChannelSheet: vi.fn().mockResolvedValue(undefined)
  }))
}));

vi.mock('../../src/services/MessageManager', () => ({
  MessageManager: vi.fn().mockImplementation(() => ({
    createOrUpdateMessageWithMetadataV2: vi.fn().mockResolvedValue({
      success: true,
      message: { id: 'test-message-id' }
    })
  }))
}));

vi.mock('../../src/services/MetadataManager', () => ({
  MetadataManager: {
    getInstance: vi.fn().mockReturnValue({
      getChannelMetadata: vi.fn().mockResolvedValue({ 
        success: false,
        metadata: null 
      }),
      createChannelMetadata: vi.fn().mockResolvedValue({ success: true }),
      updateChannelMetadata: vi.fn().mockResolvedValue({ success: true })
    })
  }
}));

vi.mock('../../src/services/ListInitializationService', () => ({
  ListInitializationService: vi.fn().mockImplementation(() => ({
    initializeList: vi.fn().mockResolvedValue({
      success: true,
      message: 'リストを同期しました',
      itemCount: 0
    })
  }))
}));

describe('InitListButtonHandler', () => {
  let handler: InitListButtonHandler;
  let logger: Logger;
  let mockInitListCommand: InitListCommand;
  let mockInteraction: ButtonInteraction;
  let context: ButtonHandlerContext;

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG);
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    // InitListCommandのモック
    mockInitListCommand = {
      execute: vi.fn()
    } as any;

    // ボタンインタラクションのモック（optionsプロパティは存在しない）
    mockInteraction = {
      customId: 'init-list-button',
      user: {
        id: 'user123',
        bot: false
      },
      guildId: 'guild456',
      channelId: 'channel789',
      channel: { name: 'test-channel' },
      client: {},
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined)
      // options プロパティは ButtonInteraction には存在しない
    } as any;

    context = {
      interaction: mockInteraction
    };

    handler = new InitListButtonHandler(logger, undefined, undefined, mockInitListCommand);
  });

  describe('executeAction', () => {
    it('ボタンインタラクションでエラーが発生することを確認する（Red フェーズ）', async () => {
      // ListInitializationServiceでエラーが発生する場合をシミュレート
      const mockListInitializationService = {
        initializeList: vi.fn().mockRejectedValue(new Error('Cannot read properties of undefined (reading \'getString\')'))
      };
      handler['listInitializationService'] = mockListInitializationService as any;

      // ボタンインタラクションから呼び出されるため、エラーが発生するはず（OperationResultでエラーを返す）
      const result = await handler['executeAction'](context);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toMatch(/Cannot read properties of undefined/);
    });
  });

  describe('getOperationInfo', () => {
    it('should return operation info for list initialization', () => {
      const operationInfo: OperationInfo = handler.getOperationInfo();
      
      expect(operationInfo).toEqual({
        operationType: 'init',
        actionName: 'リスト初期化'
      });
    });
  });

  describe('executeAction with operation logging', () => {
    it('should return OperationResult on successful initialization', async () => {
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBe('リストを同期しました');
    });

    it('should include initialized item count in operation details', async () => {
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.affectedItems).toBe(0); // 空のデータなので0
    });

    it('should handle initialization cancellation', async () => {
      // ListInitializationServiceをモック
      const mockListInitializationService = {
        initializeList: vi.fn().mockRejectedValue(new Error('cancelled'))
      };
      handler['listInitializationService'] = mockListInitializationService as any;
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.details?.cancelReason).toBe('ユーザーによる同期キャンセル');
    });

    it('should handle initialization failure', async () => {
      // ListInitializationServiceをモック
      const mockListInitializationService = {
        initializeList: vi.fn().mockRejectedValue(new Error('Initialization failed'))
      };
      handler['listInitializationService'] = mockListInitializationService as any;
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.message).toBe('同期に失敗しました');
    });
  });
});
