import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import { InitListCommand } from '../../src/commands/InitListCommand';
import { Logger, LogLevel } from '../../src/utils/logger';
import { CommandExecutionContext } from '../../src/base/BaseCommand';
import { CommandError } from '../../src/utils/CommandError';

// モック設定は必要だが、import は不要（モックオブジェクトを直接作成するため）

describe('InitListCommand', () => {
  let logger: Logger;
  let loggerInfoSpy: MockedFunction<typeof logger.info>;
  let loggerDebugSpy: MockedFunction<typeof logger.debug>;
  let _loggerErrorSpy: MockedFunction<typeof logger.error>;
  let initListCommand: InitListCommand;
  let mockGoogleSheetsService: any;
  let mockChannelSheetManager: any;
  let mockMessageManager: any;
  let mockMetadataManager: any;
  let mockInteraction: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    logger = new Logger(LogLevel.DEBUG);
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    loggerDebugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    _loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    
    // GoogleSheetsServiceのモック
    mockGoogleSheetsService = {
      checkSpreadsheetExists: vi.fn().mockResolvedValue(true),
      createChannelSheet: vi.fn(),
      getSheetData: vi.fn().mockResolvedValue([]),
      validateData: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
      normalizeData: vi.fn().mockReturnValue([])
    };
    
    // ChannelSheetManagerのモック
    mockChannelSheetManager = {
      getOrCreateChannelSheet: vi.fn(),
      verifySheetAccess: vi.fn().mockResolvedValue(true) // デフォルトは成功
    };
    
    // MessageManagerのモック
    mockMessageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        updated: false
      }),
      createOrUpdateMessageWithMetadata: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        updated: false
      })
    };
    
    // MetadataManagerのモック
    mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: {
          channelId: 'test-channel-id',
          messageId: 'test-message-id',
          listTitle: 'Test List',
          listType: 'shopping',
          lastSyncTime: new Date()
        }
      }),
      updateChannelMetadata: vi.fn().mockResolvedValue({
        success: true
      })
    };
    
    // Discordインタラクションのモック
    mockInteraction = {
      reply: vi.fn(),
      deferReply: vi.fn(),
      editReply: vi.fn(),
      user: { id: 'test-user-id' },
      guildId: 'test-guild-id',
      channelId: 'test-channel-id',
      channel: { name: 'test-channel' },
      client: {},
      options: {
        getString: vi.fn().mockReturnValue(null)
      }
    };
    
    initListCommand = new InitListCommand(
      logger, 
      mockChannelSheetManager, 
      mockMessageManager,
      mockMetadataManager,
      mockGoogleSheetsService
    );
  });

  describe('コンストラクタ', () => {
    it('名前が"init-list"に設定される', () => {
      expect(initListCommand.getName()).toBe('init-list');
    });

    it('説明が適切に設定される', () => {
      expect(initListCommand.getDescription()).toBe('リストの初期化を行います');
    });

    it('ephemeralオプションがtrueに設定される', () => {
      expect(initListCommand.getEphemeral()).toBe(true);
    });
  });

  describe('execute メソッド - 基本動作', () => {
    it('コンテキストなしでも実行できる', async () => {
      await initListCommand.execute();
      
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        'Init list command started',
        expect.objectContaining({
          userId: undefined,
          guildId: undefined
        })
      );
    });

    it('チャンネルIDが提供された場合、シート初期化処理を実行する', async () => {
      const context: CommandExecutionContext = {
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // モック設定
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      });

      await initListCommand.execute(context);
      
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        'Init list command started',
        expect.objectContaining({
          userId: 'test-user-id',
          guildId: 'test-guild-id'
        })
      );
    });
  });

  describe('execute メソッド - Google Sheets連携', () => {
    it('Google Sheetsサービスとの連携でシート初期化を実行する', async () => {
      const context: CommandExecutionContext = {
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // ChannelSheetManagerのモック設定
      const mockResult = { existed: false, created: true };
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue(mockResult);

      await initListCommand.execute(context);
      
      // シート初期化処理が呼ばれることを期待
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('List initialization completed'),
        expect.objectContaining({
          userId: 'test-user-id'
        })
      );
    });

    it('既存シートが存在する場合は適切なメッセージを表示する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // 既存シートありのモック設定
      const mockResult = { existed: true, data: [['項目名', '説明', '日付', '状態']] };
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue(mockResult);

      await initListCommand.execute(context);
      
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('スプレッドシートから')
      });
    });

    it('新規シートを作成した場合は適切なメッセージを表示する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // 新規シート作成のモック設定
      const mockResult = { existed: false, created: true };
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue(mockResult);

      await initListCommand.execute(context);
      
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('スプレッドシートから')
      });
    });
  });

  describe('execute メソッド - エラーハンドリング', () => {
    it('チャンネルIDが未提供の場合はエラーをスローする', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        userId: 'test-user-id',
        guildId: 'test-guild-id'
        // channelId なし
      };

      await expect(initListCommand.execute(context)).rejects.toThrow(CommandError);
    });

    it('Google Sheetsサービスエラー時は適切にハンドリングする', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // Google Sheetsエラーのモック設定
      mockChannelSheetManager.getOrCreateChannelSheet.mockRejectedValue(
        new Error('Google Sheets API Error')
      );

      await expect(initListCommand.execute(context)).rejects.toThrow();
    });

    it('アクセス権限エラー時は適切なメッセージでエラーをスローする', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // アクセス権限エラーのモック設定
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(false);

      await expect(initListCommand.execute(context)).rejects.toThrow(CommandError);
    });
  });

  describe('execute メソッド - Discord連携', () => {
    it('interactionが提供された場合はDeferredReplyを使用する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // 正常なシート作成のモック設定
      const mockResult = { existed: false, created: true };
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue(mockResult);

      await initListCommand.execute(context);
      
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('長時間処理の場合は進行状況を適切に報告する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // 遅延処理のモック設定
      mockChannelSheetManager.getOrCreateChannelSheet.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ existed: false, created: true }), 100))
      );

      await initListCommand.execute(context);
      
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Init list command started'),
        expect.any(Object)
      );
    });
  });

  describe('データ処理テスト', () => {
    it('added_atがnullのアイテムも正常に処理される', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // added_atがnullまたは空のデータを設定
      const testData = [
        ['牛乳', '1本', 'その他'],  // added_at なし（3列のみ）
        ['パン', '1個', 'その他', ''],  // added_at 空文字列
        ['卵', '6個', 'その他', '2025-01-21'],  // added_at あり
        ['バター', '1個', 'その他', '  '],  // added_at 空白のみ
        ['チーズ', '200g', 'その他', 'invalid-date']  // 無効な日付
      ];

      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue(testData);
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
      mockGoogleSheetsService.normalizeData.mockReturnValue(testData);
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      });

      await initListCommand.execute(context);
      
      // データが正常に処理されて、メッセージが5件取得されたことを確認
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '✅ スプレッドシートから5件のアイテムを取得し、このチャンネルに表示しました'
      });
    });

    it('added_atが有効な場合は適切にDate型で処理される', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // 有効なadded_atを持つデータ
      const testData = [
        ['リンゴ', '5個', 'その他', '2025-01-21T10:00:00']
      ];

      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue(testData);
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
      mockGoogleSheetsService.normalizeData.mockReturnValue(testData);
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      });

      await initListCommand.execute(context);
      
      // 1件のアイテムが処理されたことを確認
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '✅ スプレッドシートから1件のアイテムを取得し、このチャンネルに表示しました'
      });
    });

    it('should preserve check status from existing data during initialization', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // 完了フラグ(check)を含むデータ
      const testData = [
        ['name', 'category', 'until', 'check'],
        ['完了済みアイテム', 'その他', '', '1'],
        ['未完了アイテム', 'その他', '2024-12-31', '0'],
        ['無効フラグアイテム', 'その他', '', 'invalid']
      ];

      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue(testData);
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
      mockGoogleSheetsService.normalizeData.mockReturnValue(testData);
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: true,
        created: false
      });
      
      // ListFormatterをモックして、渡されたitemsを検証
      const ListFormatterModule = await import('../../src/ui/ListFormatter');
      const formatDataListSpy = vi.spyOn(ListFormatterModule.ListFormatter, 'formatDataList');
      
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      });

      await initListCommand.execute(context);

      // formatDataListに渡されたitemsを検証（check値が正しく読み込まれているか）
      expect(formatDataListSpy).toHaveBeenCalled();
      const [, items] = formatDataListSpy.mock.calls[0];
      
      // checkフラグが正しく設定されていることを期待（現在はfalseになっているはず）
      expect(items[0].check).toBe(true);  // '1' -> true
      expect(items[1].check).toBe(false); // '0' -> false  
      expect(items[2].check).toBe(false); // 'invalid' -> false
      
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '✅ スプレッドシートから3件のアイテムを取得し、このチャンネルに表示しました'
      });
    });
  });

  describe('デフォルトカテゴリー処理テスト', () => {
    it('default-category引数がある場合、指定されたカテゴリーを使用する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // default-category引数を設定
      mockInteraction.options.getString.mockReturnValue('食材');

      // 全依存関係の正常モック設定
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue([]);
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
      mockGoogleSheetsService.normalizeData.mockReturnValue([]);
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      });

      await initListCommand.execute(context);
      
      // createOrUpdateMessageWithMetadataが指定されたカテゴリーで呼ばれることを確認
      expect(mockMessageManager.createOrUpdateMessageWithMetadata).toHaveBeenCalledWith(
        'test-channel-id',
        expect.any(Object), // embed
        'test-channelリスト',
        expect.any(Object), // client
        'list',
        '食材'
      );
    });

    it('default-category引数がない場合で、既存のメタデータにデフォルトカテゴリーがある場合、それを保持する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // default-category引数なし
      mockInteraction.options.getString.mockReturnValue(null);

      // 既存メタデータにデフォルトカテゴリー設定
      mockMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: {
          channelId: 'test-channel-id',
          messageId: 'test-message-id',
          listTitle: 'Test List',
          listType: 'shopping',
          lastSyncTime: new Date(),
          defaultCategory: '既存カテゴリー'
        }
      });

      // 全依存関係の正常モック設定
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue([]);
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
      mockGoogleSheetsService.normalizeData.mockReturnValue([]);
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      });

      await initListCommand.execute(context);
      
      // createOrUpdateMessageWithMetadataが既存カテゴリーで呼ばれることを確認
      expect(mockMessageManager.createOrUpdateMessageWithMetadata).toHaveBeenCalledWith(
        'test-channel-id',
        expect.any(Object), // embed
        'test-channelリスト',
        expect.any(Object), // client
        'list',
        '既存カテゴリー'
      );
    });

    it('default-category引数がない場合で、既存のメタデータにデフォルトカテゴリーがない場合、「その他」を設定する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // default-category引数なし
      mockInteraction.options.getString.mockReturnValue(null);

      // 既存メタデータなし
      mockMetadataManager.getChannelMetadata.mockResolvedValue({
        success: false,
        message: 'チャンネルのメタデータが見つかりません'
      });

      // 全依存関係の正常モック設定
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue([]);
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
      mockGoogleSheetsService.normalizeData.mockReturnValue([]);
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      });

      await initListCommand.execute(context);
      
      // createOrUpdateMessageWithMetadataが「その他」で呼ばれることを確認
      expect(mockMessageManager.createOrUpdateMessageWithMetadata).toHaveBeenCalledWith(
        'test-channel-id',
        expect.any(Object), // embed
        'test-channelリスト',
        expect.any(Object), // client
        'list',
        'その他'
      );
    });
  });

  describe('カテゴリが空の場合のdefaultCategory処理', () => {
    it('データのカテゴリが空の場合、metadataのdefaultCategoryが使用される', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // カテゴリが空のデータを設定
      const testData = [
        ['name', 'category', 'added_at', 'until'], // ヘッダー行
        ['牛乳', '', '2025-01-21'], // カテゴリが空
        ['パン', '  ', '2025-01-21'], // カテゴリが空白のみ
        ['卵', '食材', '2025-01-21'] // カテゴリあり
      ];

      // メタデータにdefaultCategoryを設定
      mockMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: {
          channelId: 'test-channel-id',
          messageId: 'test-message-id',
          listTitle: 'Test List',
          listType: 'shopping',
          lastSyncTime: new Date(),
          defaultCategory: '日用品'
        }
      });

      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue(testData);
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
      mockGoogleSheetsService.normalizeData.mockReturnValue(testData);
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      });
      
      // ListFormatterをモックして、渡されたitemsを検証
      const ListFormatterModule = await import('../../src/ui/ListFormatter');
      const formatDataListSpy = vi.spyOn(ListFormatterModule.ListFormatter, 'formatDataList');

      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      });

      await initListCommand.execute(context);
      
      // formatDataListに渡されたitemsを検証
      expect(formatDataListSpy).toHaveBeenCalled();
      const [, items, channelId, defaultCategory] = formatDataListSpy.mock.calls[0];
      
      // channelIdが正しく渡されていることを確認
      expect(channelId).toBe('test-channel-id');
      // defaultCategoryが正しく渡されていることを確認
      expect(defaultCategory).toBe('日用品');
      
      // カテゴリが空のアイテムがdefaultCategoryを使用していることを確認
      expect(items[0].category).toBe('日用品'); // 空文字列の場合
      expect(items[1].category).toBe('日用品'); // 空白のみの場合
      expect(items[2].category).toBe('食材'); // 明示的に指定されている場合
    });
  });

  describe('統合テスト', () => {
    it('完全な初期化フローが正常に動作する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // 全依存関係の正常モック設定
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue([]);
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
      mockGoogleSheetsService.normalizeData.mockReturnValue([]);
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      });

      await initListCommand.execute(context);
      
      // 実行ログの確認
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        'Init list command started',
        expect.objectContaining({
          userId: 'test-user-id',
          guildId: 'test-guild-id'
        })
      );
      
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Completion message sent',
        expect.objectContaining({
          userId: 'test-user-id'
        })
      );
      
      expect(loggerDebugSpy).toHaveBeenCalledWith('Init list command completed');
    });

    it('ボタンインタラクション（options undefined）でも正常に動作する', async () => {
      // ボタンインタラクションをシミュレート（optionsがundefined）
      const buttonInteraction = {
        reply: vi.fn(),
        deferReply: vi.fn(),
        editReply: vi.fn(),
        user: { id: 'test-user-id' },
        guildId: 'test-guild-id',
        channelId: 'test-channel-id',
        channel: { name: 'test-channel' },
        client: {},
        options: undefined // 明示的にundefinedを設定
      };

      const context: CommandExecutionContext = {
        interaction: buttonInteraction as any,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      };

      // 全依存関係の正常モック設定
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue([]);
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
      mockGoogleSheetsService.normalizeData.mockReturnValue([]);
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      });

      // 修正後は正常に動作するはず（Green phase）
      await expect(initListCommand.execute(context)).resolves.not.toThrow();
    });
  });
});