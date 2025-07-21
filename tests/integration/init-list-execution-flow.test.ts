import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InitListCommand } from '../../src/commands/InitListCommand';
import { Logger, LogLevel } from '../../src/utils/logger';
import { CommandExecutionContext } from '../../src/base/BaseCommand';

// init-listコマンドの実行フロー詳細確認テスト
describe('InitList Command Execution Flow Tests', () => {
  let logger: Logger;
  let loggerDebugSpy: any;
  let loggerInfoSpy: any;
  let loggerErrorSpy: any;
  let initListCommand: InitListCommand;
  let mockGoogleSheetsService: any;
  let mockChannelSheetManager: any;
  let mockMessageManager: any;
  let mockMetadataManager: any;
  let mockInteraction: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    logger = new Logger(LogLevel.DEBUG);
    loggerDebugSpy = vi.spyOn(logger, 'debug').mockImplementation((...args) => {
      console.log('[DEBUG]', ...args);
    });
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation((...args) => {
      console.log('[INFO]', ...args);
    });
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation((...args) => {
      console.log('[ERROR]', ...args);
    });
    
    // GoogleSheetsServiceのモック
    mockGoogleSheetsService = {
      checkSpreadsheetExists: vi.fn().mockImplementation(() => {
        console.log('[MOCK] checkSpreadsheetExists called');
        return Promise.resolve(true);
      }),
      getSheetData: vi.fn().mockImplementation((sheetName) => {
        console.log('[MOCK] getSheetData called with:', sheetName);
        return Promise.resolve([]);
      }),
      validateData: vi.fn().mockImplementation((data) => {
        console.log('[MOCK] validateData called with data length:', data.length);
        return { isValid: true, errors: [] };
      }),
      normalizeData: vi.fn().mockImplementation((data) => {
        console.log('[MOCK] normalizeData called with data length:', data.length);
        return data;
      })
    };
    
    // ChannelSheetManagerのモック
    mockChannelSheetManager = {
      getOrCreateChannelSheet: vi.fn().mockImplementation((channelId) => {
        console.log('[MOCK] getOrCreateChannelSheet called with:', channelId);
        return Promise.resolve({
          existed: false,
          created: true
        });
      })
    };
    
    // MessageManagerのモック
    mockMessageManager = {
      createOrUpdateMessageWithMetadata: vi.fn().mockImplementation((channelId, embed, listTitle, listType, client) => {
        console.log('[MOCK] createOrUpdateMessageWithMetadata called with:', {
          channelId, listTitle, listType
        });
        return Promise.resolve({
          success: true,
          message: { id: 'test-message-id' }
        });
      })
    };
    
    // MetadataManagerのモック
    mockMetadataManager = {
      getChannelMetadata: vi.fn().mockImplementation((channelId) => {
        console.log('[MOCK] getChannelMetadata called with:', channelId);
        return Promise.resolve({
          success: false,
          message: 'チャンネルのメタデータが見つかりません'
        });
      }),
      createChannelMetadata: vi.fn().mockImplementation((channelId, metadata) => {
        console.log('[MOCK] createChannelMetadata called with:', { channelId, metadata });
        return Promise.resolve({ success: true });
      }),
      updateChannelMetadata: vi.fn().mockImplementation((channelId, metadata) => {
        console.log('[MOCK] updateChannelMetadata called with:', { channelId, metadata });
        return Promise.resolve({ success: true });
      })
    };
    
    // Discordインタラクションのモック
    mockInteraction = {
      deferReply: vi.fn().mockImplementation(() => {
        console.log('[MOCK] deferReply called');
        return Promise.resolve();
      }),
      editReply: vi.fn().mockImplementation((options) => {
        console.log('[MOCK] editReply called with:', options);
        return Promise.resolve();
      }),
      user: { id: 'test-user-id' },
      guildId: 'test-guild-id',
      channelId: 'test-channel-id',
      client: {}
    };
    
    initListCommand = new InitListCommand(
      logger,
      mockChannelSheetManager,
      mockMessageManager,
      mockMetadataManager,
      mockGoogleSheetsService
    );
  });

  describe('実行フロー詳細確認', () => {
    it('完全なコンテキストでの実行フロー', async () => {
      console.log('\n=== Test: 完全なコンテキストでの実行フロー ===');
      
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      console.log('Context:', {
        hasInteraction: !!context.interaction,
        channelId: context.channelId,
        userId: context.userId,
        guildId: context.guildId
      });

      await initListCommand.execute(context);

      console.log('\n=== モック呼び出し回数確認 ===');
      console.log('checkSpreadsheetExists:', mockGoogleSheetsService.checkSpreadsheetExists.mock.calls.length);
      console.log('getOrCreateChannelSheet:', mockChannelSheetManager.getOrCreateChannelSheet.mock.calls.length);
      console.log('getSheetData:', mockGoogleSheetsService.getSheetData.mock.calls.length);
      console.log('createOrUpdateMessageWithMetadata:', mockMessageManager.createOrUpdateMessageWithMetadata.mock.calls.length);
      console.log('deferReply:', mockInteraction.deferReply.mock.calls.length);
      console.log('editReply:', mockInteraction.editReply.mock.calls.length);
    });

    it('interactionなしでの実行フロー', async () => {
      console.log('\n=== Test: interactionなしでの実行フロー ===');
      
      const context: CommandExecutionContext = {
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
        // interactionなし
      };

      console.log('Context:', {
        hasInteraction: !!context.interaction,
        channelId: context.channelId
      });

      await initListCommand.execute(context);

      console.log('\n=== モック呼び出し回数確認 ===');
      console.log('createOrUpdateMessageWithMetadata:', mockMessageManager.createOrUpdateMessageWithMetadata.mock.calls.length);
    });

    it('channelIdなしでの実行フロー', async () => {
      console.log('\n=== Test: channelIdなしでの実行フロー ===');
      
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        userId: 'test-user-id',
        guildId: 'test-guild-id'
        // channelIdなし
      };

      console.log('Context:', {
        hasInteraction: !!context.interaction,
        channelId: context.channelId
      });

      try {
        await initListCommand.execute(context);
      } catch (error) {
        console.log('Expected error caught:', error.message);
      }
    });

    it('同時実行での処理フロー', async () => {
      console.log('\n=== Test: 同時実行での処理フロー ===');
      
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // 同時に3回実行
      console.log('Starting 3 concurrent executions...');
      const promises = [
        initListCommand.execute(context),
        initListCommand.execute(context),
        initListCommand.execute(context)
      ];

      await Promise.all(promises);

      console.log('\n=== 同時実行後のモック呼び出し回数 ===');
      console.log('checkSpreadsheetExists:', mockGoogleSheetsService.checkSpreadsheetExists.mock.calls.length);
      console.log('getOrCreateChannelSheet:', mockChannelSheetManager.getOrCreateChannelSheet.mock.calls.length);
      console.log('createOrUpdateMessageWithMetadata:', mockMessageManager.createOrUpdateMessageWithMetadata.mock.calls.length);
      console.log('deferReply:', mockInteraction.deferReply.mock.calls.length);
      console.log('editReply:', mockInteraction.editReply.mock.calls.length);
    });
  });
});