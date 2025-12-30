import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { ListInitializationService } from '../../src/services/ListInitializationService';
import { CommandExecutionContext } from '../../src/base/BaseCommand';
import { CommandError } from '../../src/utils/CommandError';
import { ListFormatter } from '../../src/ui/ListFormatter';

// モック設定
vi.mock('../../src/services/GoogleSheetsService');
vi.mock('../../src/services/MessageManager');
vi.mock('../../src/services/MetadataManager');
vi.mock('../../src/services/ChannelSheetManager');
vi.mock('../../src/ui/ListFormatter');
vi.mock('../../src/utils/logger');

// Discord.js モック
const mockClient = {
  channels: {
    fetch: vi.fn()
  }
};

const mockThread = {
  id: 'thread-123',
  name: '操作ログ',
  type: ChannelType.PublicThread
};

const mockChannel = {
  id: 'test-channel-123',
  name: 'test-channel',
  type: ChannelType.GuildText,
  send: vi.fn(),
  messages: {
    fetch: vi.fn()
  },
  threads: {
    create: vi.fn()
  }
};

const mockMessage = {
  id: 'test-message-456',
  pinned: false,
  pin: vi.fn(),
  unpin: vi.fn(),
  edit: vi.fn(),
  startThread: vi.fn()
};

const mockInteraction = {
  channelId: 'test-channel-123',
  guildId: 'test-guild-123',
  user: { id: 'test-user-123' },
  client: mockClient,
  channel: mockChannel,
  options: {
    getString: vi.fn(),
    getBoolean: vi.fn()
  }
};

describe('ListInitializationService', () => {
  let service: ListInitializationService;
  let mockGoogleSheetsService: any;
  let mockMessageManager: any;
  let mockMetadataManager: any;
  let mockChannelSheetManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // モックサービスの作成
    mockGoogleSheetsService = {
      getSheetData: vi.fn(),
      validateData: vi.fn(),
      normalizeData: vi.fn()
    };

    mockMessageManager = {
      createOrUpdateMessageWithMetadataV2: vi.fn()
    };

    mockMetadataManager = {
      getChannelMetadata: vi.fn(),
      createChannelMetadata: vi.fn(),
      updateChannelMetadata: vi.fn()
    };

    mockChannelSheetManager = {
      getOrCreateChannelSheet: vi.fn()
    };

    // サービスインスタンスの作成
    service = new ListInitializationService(
      mockGoogleSheetsService,
      mockMessageManager,
      mockMetadataManager,
      mockChannelSheetManager
    );

    // デフォルトモック設定
    mockChannelSheetManager.getOrCreateChannelSheet.mockResolvedValue(undefined);
    mockGoogleSheetsService.getSheetData.mockResolvedValue([]);
    mockGoogleSheetsService.validateData.mockReturnValue({ isValid: true, errors: [] });
    mockGoogleSheetsService.normalizeData.mockImplementation((data) => data);
    mockMessageManager.createOrUpdateMessageWithMetadataV2.mockResolvedValue({
      success: true,
      message: mockMessage
    });
    mockMetadataManager.getChannelMetadata.mockResolvedValue({
      success: false,
      metadata: null
    });

    // ListFormatterのモック設定
    const mockContent = 'test content';
    vi.mocked(ListFormatter.formatEmptyListContent).mockResolvedValue(mockContent);
    vi.mocked(ListFormatter.formatDataListContent).mockResolvedValue(mockContent);
    vi.mocked(ListFormatter.buildListComponents).mockReturnValue([]);

    // スレッド作成のモック設定
    mockChannel.threads.create.mockResolvedValue(mockThread);
    mockClient.channels.fetch.mockResolvedValue(mockChannel);
  });

  describe('initializeList', () => {
    const createMockContext = (_enableLog: boolean | null = null): CommandExecutionContext => ({
      interaction: mockInteraction as any,
      userId: 'test-user-123',
      guildId: 'test-guild-123',
      channelId: 'test-channel-123'
    });

    describe('操作ログスレッド制御', () => {
      it('enableLog=trueの場合、操作ログスレッドを作成する', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = true;
        const defaultCategory = 'テスト';

        mockMessageManager.createOrUpdateMessageWithMetadataV2.mockResolvedValue({
          success: true,
          message: mockMessage,
          operationLogThreadId: 'thread-123'
        });

        // Act
        const result = await service.initializeList(context, enableLog, defaultCategory);

        // Assert
        expect(result.success).toBe(true);
        expect(mockChannel.threads.create).toHaveBeenCalledWith({
          name: '操作ログ',
          autoArchiveDuration: 1440,
          reason: 'リスト操作の記録用スレッド'
        });
        expect(mockMessageManager.createOrUpdateMessageWithMetadataV2).toHaveBeenCalledWith(
          'test-channel-123',
          expect.any(Array), // components
          'test-channelリスト',
          mockClient,
          'list',
          'テスト',
          'thread-123' // 作成されたスレッドID
        );
      });

      it('enableLog=falseの場合、操作ログスレッドを作成しない', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = false;
        const defaultCategory = 'テスト';

        // Act
        const result = await service.initializeList(context, enableLog, defaultCategory);

        // Assert
        expect(result.success).toBe(true);
        expect(mockMessageManager.createOrUpdateMessageWithMetadataV2).toHaveBeenCalledWith(
          'test-channel-123',
          expect.any(Array), // components
          'test-channelリスト',
          mockClient,
          'list',
          'テスト',
          '' // 空文字列で削除指示
        );
      });

      it('enableLog=null（既存状態保持）の場合、既存のoperationLogThreadIdを保持する', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = null; // 既存状態保持（同期ボタン用）
        const defaultCategory = 'テスト';

        const existingMetadata = {
          channelId: 'test-channel-123',
          messageId: 'existing-message',
          listTitle: '既存タイトル',
          lastSyncTime: new Date(),
          defaultCategory: 'テスト',
          operationLogThreadId: 'existing-thread-123'
        };

        mockMetadataManager.getChannelMetadata.mockResolvedValue({
          success: true,
          metadata: existingMetadata
        });

        // Act
        const result = await service.initializeList(context, enableLog, defaultCategory);

        // Assert
        expect(result.success).toBe(true);
        expect(mockMessageManager.createOrUpdateMessageWithMetadataV2).toHaveBeenCalledWith(
          'test-channel-123',
          expect.any(Array), // components
          'test-channelリスト',
          mockClient,
          'list',
          'テスト',
          'existing-thread-123' // 既存値を保持
        );
      });

      it('enableLog=nullで既存メタデータが存在しない場合、operationLogThreadIdは空文字列になる', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = null;
        const defaultCategory = 'テスト';

        mockMetadataManager.getChannelMetadata.mockResolvedValue({
          success: false,
          metadata: null
        });

        // Act
        const result = await service.initializeList(context, enableLog, defaultCategory);

        // Assert
        expect(result.success).toBe(true);
        expect(mockMessageManager.createOrUpdateMessageWithMetadataV2).toHaveBeenCalledWith(
          'test-channel-123',
          expect.any(Array), // components
          'test-channelリスト',
          mockClient,
          'list',
          'テスト',
          '' // 空文字列
        );
      });
    });

    describe('デフォルトカテゴリ処理', () => {
      it('指定されたdefaultCategoryを使用する', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = false;
        const defaultCategory = 'カスタムカテゴリ';

        // Act
        const result = await service.initializeList(context, enableLog, defaultCategory);

        // Assert
        expect(result.success).toBe(true);
        expect(mockMessageManager.createOrUpdateMessageWithMetadataV2).toHaveBeenCalledWith(
          'test-channel-123',
          expect.any(Array), // components
          'test-channelリスト',
          mockClient,
          'list',
          'カスタムカテゴリ',
          ''
        );
      });
    });

    describe('エラーハンドリング', () => {
      it('チャンネルIDが存在しない場合はエラーを返す', async () => {
        // Arrange
        const invalidContext = {
          ...createMockContext(),
          channelId: undefined
        };
        const enableLog = false;
        const defaultCategory = 'テスト';

        // Act & Assert
        await expect(service.initializeList(invalidContext, enableLog, defaultCategory))
          .rejects.toThrow(CommandError);
      });

      it('interactionが存在しない場合はエラーを返す', async () => {
        // Arrange
        const invalidContext = {
          ...createMockContext(),
          interaction: undefined
        };
        const enableLog = false;
        const defaultCategory = 'テスト';

        // Act & Assert
        await expect(service.initializeList(invalidContext, enableLog, defaultCategory))
          .rejects.toThrow(CommandError);
      });

      it('ChannelSheetManagerでエラーが発生した場合は適切に処理する', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = false;
        const defaultCategory = 'テスト';

        mockChannelSheetManager.getOrCreateChannelSheet.mockRejectedValue(
          new Error('Sheet creation failed')
        );

        // Act & Assert
        await expect(service.initializeList(context, enableLog, defaultCategory))
          .rejects.toThrow(CommandError);
      });

      it('MessageManagerでエラーが発生した場合は適切に処理する', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = false;
        const defaultCategory = 'テスト';

        mockMessageManager.createOrUpdateMessageWithMetadataV2.mockResolvedValue({
          success: false,
          errorMessage: 'Message creation failed'
        });

        // Act & Assert
        await expect(service.initializeList(context, enableLog, defaultCategory))
          .rejects.toThrow(CommandError);
      });
    });

    describe('データ処理', () => {
      it('Google Sheetsからデータを取得してリストアイテムに変換する', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = false;
        const defaultCategory = 'テスト';

        const mockSheetData = [
          ['アイテム1', '2', 'カテゴリA', '2023-01-01', '2023-12-31'],
          ['アイテム2', '1', 'カテゴリB', '2023-01-02', '']
        ];

        mockGoogleSheetsService.getSheetData.mockResolvedValue(mockSheetData);

        // Act
        const result = await service.initializeList(context, enableLog, defaultCategory);

        // Assert
        expect(result.success).toBe(true);
        expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalledWith('test-channel-123');
      });

      it('空のデータの場合でも適切に処理する', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = false;
        const defaultCategory = 'テスト';

        mockGoogleSheetsService.getSheetData.mockResolvedValue([]);

        // Act
        const result = await service.initializeList(context, enableLog, defaultCategory);

        // Assert
        expect(result.success).toBe(true);
        expect(mockMessageManager.createOrUpdateMessageWithMetadataV2).toHaveBeenCalled();
      });
    });

    describe('リストタイトル生成', () => {
      it('チャンネル名からリストタイトルを動的生成する', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = false;
        const defaultCategory = 'テスト';

        // Act
        const result = await service.initializeList(context, enableLog, defaultCategory);

        // Assert
        expect(result.success).toBe(true);
        expect(mockMessageManager.createOrUpdateMessageWithMetadataV2).toHaveBeenCalledWith(
          'test-channel-123',
          expect.any(Array), // components
          'test-channelリスト', // チャンネル名 + 'リスト'
          mockClient,
          'list',
          'テスト',
          ''
        );
      });

      it('チャンネル名が取得できない場合はデフォルトタイトルを使用する', async () => {
        // Arrange
        const context = createMockContext();
        const enableLog = false;
        const defaultCategory = 'テスト';

        // チャンネル名が取得できない場合をシミュレート
        const mockInteractionWithoutName = {
          ...mockInteraction,
          channel: null
        };

        const contextWithoutChannelName = {
          ...context,
          interaction: mockInteractionWithoutName as any
        };

        // Act
        const result = await service.initializeList(contextWithoutChannelName, enableLog, defaultCategory);

        // Assert
        expect(result.success).toBe(true);
        expect(mockMessageManager.createOrUpdateMessageWithMetadataV2).toHaveBeenCalledWith(
          'test-channel-123',
          expect.any(Array), // components
          'リストリスト', // デフォルト名 + 'リスト'
          mockClient,
          'list',
          'テスト',
          ''
        );
      });
    });
  });
});
