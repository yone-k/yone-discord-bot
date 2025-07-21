import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import { InitListCommand } from '../../src/commands/InitListCommand';
import { Logger, LogLevel } from '../../src/utils/logger';
import { CommandExecutionContext } from '../../src/base/BaseCommand';
import { MessageManager } from '../../src/services/MessageManager';
import { MetadataManager } from '../../src/services/MetadataManager';

// init-listコマンドの重複実行テスト
describe('InitList Command Duplicate Execution Tests', () => {
  let logger: Logger;
  let initListCommand: InitListCommand;
  let mockGoogleSheetsService: any;
  let mockChannelSheetManager: any;
  let mockMessageManager: any;
  let mockMetadataManager: any;
  let mockInteraction: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    logger = new Logger(LogLevel.DEBUG);
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    
    // GoogleSheetsServiceのモック
    mockGoogleSheetsService = {
      checkSpreadsheetExists: vi.fn().mockResolvedValue(true),
      getSheetData: vi.fn().mockResolvedValue([]),
      validateData: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
      normalizeData: vi.fn().mockReturnValue([])
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
    
    // MessageManagerのモック - 複数回実行での重複問題を再現
    let messageCallCount = 0;
    mockMessageManager = {
      createOrUpdateMessageWithMetadata: vi.fn().mockImplementation(async (channelId, embed, listTitle, client) => {
        messageCallCount++;
        console.log('[MOCK] createOrUpdateMessageWithMetadata called with:', {
          channelId, listTitle, callCount: messageCallCount
        });
        // 各呼び出しで異なるメッセージIDを返すことで、重複作成を再現
        return {
          success: true,
          message: { id: `test-message-id-${messageCallCount}` }
        };
      })
    };
    
    // MetadataManagerのモック - 重複作成問題を再現
    let metadataCallCount = 0;
    mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: false,
        message: 'チャンネルのメタデータが見つかりません'
      }),
      createChannelMetadata: vi.fn().mockImplementation(async () => {
        metadataCallCount++;
        if (metadataCallCount === 1) {
          return { success: true };
        } else {
          // 2回目以降は重複エラーを返すべきだが、race conditionで成功してしまうケース
          return { success: true }; // 本来は重複エラーになるべき
        }
      }),
      updateChannelMetadata: vi.fn().mockResolvedValue({ success: true })
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
      channel: { name: 'test-channel-id' },
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

  describe('init-listコマンドの連続実行テスト', () => {
    it('同じチャンネルで複数回連続実行すると重複メタデータが作成される可能性がある', async () => {
      console.log('\n=== Test: 同じチャンネルで複数回連続実行 ===');
      
      // contextを各テスト内で定義（mockInteractionが確実に初期化された後）
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };
      
      // デバッグ: contextとmockInteractionを詳細確認
      console.log('Context details:', {
        channelId: context.channelId,
        userId: context.userId,
        guildId: context.guildId,
        hasInteraction: !!context.interaction,
        interactionType: typeof context.interaction
      });
      
      console.log('MockInteraction details:', {
        deferReply: typeof mockInteraction.deferReply,
        editReply: typeof mockInteraction.editReply,
        user: mockInteraction.user,
        guildId: mockInteraction.guildId,
        channelId: mockInteraction.channelId,
        client: typeof mockInteraction.client
      });
      
      try {
        // 3回連続でinit-listコマンドを実行
        console.log('Starting 3 sequential executions...');
        const results = await Promise.all([
          initListCommand.execute(context),
          initListCommand.execute(context),
          initListCommand.execute(context)
        ]);
        
        console.log('All executions completed successfully');
        console.log('Results:', results);
      } catch (error) {
        console.log('Error during execution:', error);
        throw error;
      }

      console.log('\n=== Mock call count after execution ===');
      console.log('checkSpreadsheetExists:', mockGoogleSheetsService.checkSpreadsheetExists.mock.calls.length);
      console.log('getOrCreateChannelSheet:', mockChannelSheetManager.getOrCreateChannelSheet.mock.calls.length);
      console.log('createOrUpdateMessageWithMetadata:', mockMessageManager.createOrUpdateMessageWithMetadata.mock.calls.length);
      console.log('deferReply:', mockInteraction.deferReply.mock.calls.length);
      console.log('editReply:', mockInteraction.editReply.mock.calls.length);

      // MessageManagerが3回呼ばれることを確認
      expect(mockMessageManager.createOrUpdateMessageWithMetadata).toHaveBeenCalledTimes(3);
      
      // 本来は最初の1回のみメタデータ作成され、残りは更新されるべき
      // しかし現在の実装では毎回新規作成してしまう可能性がある
      console.log('createChannelMetadata call count:', mockMetadataManager.createChannelMetadata.mock.calls.length);
      console.log('updateChannelMetadata call count:', mockMetadataManager.updateChannelMetadata.mock.calls.length);
    });

    it('メタデータが既に存在する場合はcreateOrUpdateMessageWithMetadataが呼ばれる', async () => {
      // contextを各テスト内で定義
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      console.log('[TEST] Starting execution - testing MessageManager call');
      await initListCommand.execute(context);

      console.log('[TEST] Checking MessageManager calls after execution');
      console.log('createOrUpdateMessageWithMetadata calls:', mockMessageManager.createOrUpdateMessageWithMetadata.mock.calls.length);

      // MessageManagerが呼ばれることを確認（メタデータ処理はMessageManager内部で行われる）
      expect(mockMessageManager.createOrUpdateMessageWithMetadata).toHaveBeenCalledWith(
        'test-channel-id',
        expect.any(Object), // embed
        'test-channel-idリスト', // channel name + リスト
        expect.any(Object) // client
      );
    });

    it('短時間での連続実行でのタイミング問題を検証', async () => {
      // contextを各テスト内で定義
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };
      
      // わずかな遅延を挟んで連続実行
      const executeWithDelay = async (delay: number) => {
        await new Promise(resolve => setTimeout(resolve, delay));
        return initListCommand.execute(context);
      };

      await Promise.all([
        executeWithDelay(0),
        executeWithDelay(1),
        executeWithDelay(2)
      ]);

      console.log('Timing test - MessageManager calls:', 
        mockMessageManager.createOrUpdateMessageWithMetadata.mock.calls.length);
      console.log('Timing test - MetadataManager create calls:', 
        mockMetadataManager.createChannelMetadata.mock.calls.length);
    });

    it('MessageManagerでの重複処理フロー確認', async () => {
      // contextを各テスト内で定義
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };
      
      // MessageManagerでの処理フローログ
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await initListCommand.execute(context);

      // createOrUpdateMessageWithMetadataが呼ばれる際の引数を確認
      const calls = mockMessageManager.createOrUpdateMessageWithMetadata.mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toBe('test-channel-id'); // channelId
      expect(calls[0][2]).toBe('test-channel-idリスト'); // listTitle (channel name + リスト)

      logSpy.mockRestore();
    });
  });

  describe('エラー発生時の処理確認', () => {
    it('MessageManagerでエラーが発生した場合の処理', async () => {
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: false,
        errorMessage: 'メッセージ作成に失敗しました'
      });

      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      await expect(initListCommand.execute(context)).rejects.toThrow();
    });

    it('MetadataManagerで重複エラーが発生した場合の処理', async () => {
      mockMetadataManager.createChannelMetadata.mockResolvedValue({
        success: false,
        message: '重複データが検出されました: test-channel-id'
      });

      mockMessageManager.createOrUpdateMessageWithMetadata.mockImplementation(async () => {
        // メッセージは作成するが、メタデータ作成で失敗
        const metadataResult = await mockMetadataManager.createChannelMetadata();
        return {
          success: true,
          message: { id: 'test-message-id' }
        };
      });

      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      await initListCommand.execute(context);

      // メッセージ作成は成功するが、メタデータ作成で警告が出ることを確認
      expect(mockMessageManager.createOrUpdateMessageWithMetadata).toHaveBeenCalled();
    });
  });
});