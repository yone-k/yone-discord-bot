import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest'
import { InitListCommand } from '../../src/commands/InitListCommand'
import { Logger, LogLevel } from '../../src/utils/logger'
import { CommandExecutionContext } from '../../src/base/BaseCommand'
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService'
import { ChannelSheetManager } from '../../src/services/ChannelSheetManager'
import { ListFormatter } from '../../src/ui/ListFormatter'
import { CommandError, CommandErrorType } from '../../src/utils/CommandError'

// モック設定
vi.mock('../../src/services/GoogleSheetsService')
vi.mock('../../src/services/ChannelSheetManager')
vi.mock('../../src/ui/ListFormatter')

describe('InitListCommand', () => {
  let logger: Logger
  let loggerInfoSpy: MockedFunction<typeof logger.info>
  let loggerDebugSpy: MockedFunction<typeof logger.debug>
  let loggerErrorSpy: MockedFunction<typeof logger.error>
  let initListCommand: InitListCommand
  let mockGoogleSheetsService: any
  let mockChannelSheetManager: any
  let mockMessageManager: any
  let mockMetadataManager: any
  let mockInteraction: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    logger = new Logger(LogLevel.DEBUG)
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    loggerDebugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    
    // GoogleSheetsServiceのモック
    mockGoogleSheetsService = {
      checkSpreadsheetExists: vi.fn().mockResolvedValue(true),
      createChannelSheet: vi.fn(),
      getSheetData: vi.fn().mockResolvedValue([]),
      validateData: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
      normalizeData: vi.fn().mockReturnValue([])
    }
    
    // ChannelSheetManagerのモック
    mockChannelSheetManager = {
      getOrCreateChannelSheet: vi.fn(),
      verifySheetAccess: vi.fn().mockResolvedValue(true) // デフォルトは成功
    }
    
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
    }
    
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
    }
    
    // Discordインタラクションのモック
    mockInteraction = {
      reply: vi.fn(),
      deferReply: vi.fn(),
      editReply: vi.fn(),
      user: { id: 'test-user-id' },
      guildId: 'test-guild-id',
      channelId: 'test-channel-id',
      channel: { name: 'test-channel' },
      client: {}
    }
    
    initListCommand = new InitListCommand(
      logger, 
      mockChannelSheetManager, 
      mockMessageManager,
      mockMetadataManager,
      mockGoogleSheetsService
    )
  })

  describe('コンストラクタ', () => {
    it('名前が"init-list"に設定される', () => {
      expect(initListCommand.getName()).toBe('init-list')
    })

    it('説明が適切に設定される', () => {
      expect(initListCommand.getDescription()).toBe('リストの初期化を行います')
    })
  })

  describe('execute メソッド - 基本動作', () => {
    it('コンテキストなしでも実行できる', async () => {
      await initListCommand.execute()
      
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        'Init list command started',
        expect.objectContaining({
          userId: undefined,
          guildId: undefined
        })
      )
    })

    it('チャンネルIDが提供された場合、シート初期化処理を実行する', async () => {
      const context: CommandExecutionContext = {
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // モック設定
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      })

      await initListCommand.execute(context)
      
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        'Init list command started',
        expect.objectContaining({
          userId: 'test-user-id',
          guildId: 'test-guild-id'
        })
      )
    })
  })

  describe('execute メソッド - Google Sheets連携', () => {
    it('Google Sheetsサービスとの連携でシート初期化を実行する', async () => {
      const context: CommandExecutionContext = {
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // ChannelSheetManagerのモック設定
      const mockResult = { existed: false, created: true }
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue(mockResult)

      await initListCommand.execute(context)
      
      // シート初期化処理が呼ばれることを期待
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('List initialization completed'),
        expect.objectContaining({
          userId: 'test-user-id'
        })
      )
    })

    it('既存シートが存在する場合は適切なメッセージを表示する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // 既存シートありのモック設定
      const mockResult = { existed: true, data: [['項目名', '説明', '日付', '状態']] }
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue(mockResult)

      await initListCommand.execute(context)
      
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('スプレッドシートから')
      })
    })

    it('新規シートを作成した場合は適切なメッセージを表示する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // 新規シート作成のモック設定
      const mockResult = { existed: false, created: true }
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue(mockResult)

      await initListCommand.execute(context)
      
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('スプレッドシートから')
      })
    })
  })

  describe('execute メソッド - エラーハンドリング', () => {
    it('チャンネルIDが未提供の場合はエラーをスローする', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        userId: 'test-user-id',
        guildId: 'test-guild-id'
        // channelId なし
      }

      await expect(initListCommand.execute(context)).rejects.toThrow(CommandError)
    })

    it('Google Sheetsサービスエラー時は適切にハンドリングする', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // Google Sheetsエラーのモック設定
      mockChannelSheetManager.getOrCreateChannelSheet.mockRejectedValue(
        new Error('Google Sheets API Error')
      )

      await expect(initListCommand.execute(context)).rejects.toThrow()
    })

    it('アクセス権限エラー時は適切なメッセージでエラーをスローする', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // アクセス権限エラーのモック設定
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(false)

      await expect(initListCommand.execute(context)).rejects.toThrow(CommandError)
    })
  })

  describe('execute メソッド - Discord連携', () => {
    it('interactionが提供された場合はDeferredReplyを使用する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // 正常なシート作成のモック設定
      const mockResult = { existed: false, created: true }
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue(mockResult)

      await initListCommand.execute(context)
      
      expect(mockInteraction.editReply).toHaveBeenCalled()
    })

    it('長時間処理の場合は進行状況を適切に報告する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // 遅延処理のモック設定
      mockChannelSheetManager.getOrCreateChannelSheet.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ existed: false, created: true }), 100))
      )

      await initListCommand.execute(context)
      
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Init list command started'),
        expect.any(Object)
      )
    })
  })

  describe('データ処理テスト', () => {
    it('added_atがnullのアイテムも正常に処理される', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // added_atがnullまたは空のデータを設定
      const testData = [
        ['牛乳', '1本', 'その他'],  // added_at なし（3列のみ）
        ['パン', '1個', 'その他', ''],  // added_at 空文字列
        ['卵', '6個', 'その他', '2025-01-21'],  // added_at あり
        ['バター', '1個', 'その他', '  '],  // added_at 空白のみ
        ['チーズ', '200g', 'その他', 'invalid-date']  // 無効な日付
      ]

      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true)
      mockGoogleSheetsService.getSheetData.mockResolvedValue(testData)
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] })
      mockGoogleSheetsService.normalizeData.mockReturnValue(testData)
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      })
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      })

      await initListCommand.execute(context)
      
      // データが正常に処理されて、メッセージが5件取得されたことを確認
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '✅ スプレッドシートから5件のアイテムを取得し、このチャンネルに表示しました'
      })
    })

    it('added_atが有効な場合は適切にDate型で処理される', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // 有効なadded_atを持つデータ
      const testData = [
        ['リンゴ', '5個', 'その他', '2025-01-21T10:00:00']
      ]

      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true)
      mockGoogleSheetsService.getSheetData.mockResolvedValue(testData)
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] })
      mockGoogleSheetsService.normalizeData.mockReturnValue(testData)
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      })
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      })

      await initListCommand.execute(context)
      
      // 1件のアイテムが処理されたことを確認
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '✅ スプレッドシートから1件のアイテムを取得し、このチャンネルに表示しました'
      })
    })
  })

  describe('統合テスト', () => {
    it('完全な初期化フローが正常に動作する', async () => {
      const context: CommandExecutionContext = {
        interaction: mockInteraction,
        channelId: 'test-channel-id',
        userId: 'test-user-id',
        guildId: 'test-guild-id'
      }

      // 全依存関係の正常モック設定
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true)
      mockGoogleSheetsService.getSheetData.mockResolvedValue([])
      mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] })
      mockGoogleSheetsService.normalizeData.mockReturnValue([])
      mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue({
        existed: false,
        created: true
      })
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
        message: { id: 'test-message-id' }
      })

      await initListCommand.execute(context)
      
      // 実行ログの確認
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        'Init list command started',
        expect.objectContaining({
          userId: 'test-user-id',
          guildId: 'test-guild-id'
        })
      )
      
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Completion message sent',
        expect.objectContaining({
          userId: 'test-user-id'
        })
      )
      
      expect(loggerDebugSpy).toHaveBeenCalledWith('Init list command completed')
    })
  })
})