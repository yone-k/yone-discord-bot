import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OperationLogService } from '../../src/services/OperationLogService';
import { Logger } from '../../src/utils/logger';
import { MetadataManager } from '../../src/services/MetadataManager';
import { OperationInfo, OperationResult, OperationDetails } from '../../src/models/types/OperationLog';
import { ChannelType, Client } from 'discord.js';

// Discord.jsのモック
const mockClient = {
  channels: {
    fetch: vi.fn()
  }
};

const mockTextChannel = {
  id: 'test-channel-123',
  type: ChannelType.GuildText,
  threads: {
    create: vi.fn()
  }
};

const mockThread = {
  id: 'test-thread-456',
  name: '操作ログ',
  send: vi.fn()
};

// Loggerのモック
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

// MetadataManagerのモック
const mockMetadataManager = {
  getChannelMetadata: vi.fn(),
  updateChannelMetadata: vi.fn()
};

describe('OperationLogService', () => {
  let operationLogService: OperationLogService;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // デフォルトのモック設定
    mockClient.channels.fetch.mockImplementation((channelId: string) => {
      if (channelId === 'test-thread-456') {
        return Promise.resolve(mockThread);
      }
      return Promise.resolve(mockTextChannel);
    });
    mockTextChannel.threads.create.mockResolvedValue(mockThread);
    mockThread.send.mockResolvedValue({ id: 'test-log-message-789' });
    
    mockMetadataManager.getChannelMetadata.mockResolvedValue({
      success: true,
      metadata: {
        channelId: 'test-channel-123',
        messageId: 'test-message-456',
        listTitle: 'Test List',
        operationLogThreadId: 'test-thread-456'
      }
    });
    
    mockMetadataManager.updateChannelMetadata.mockResolvedValue({
      success: true
    });

    operationLogService = new OperationLogService(
      mockLogger as unknown as Logger,
      mockMetadataManager as unknown as MetadataManager
    );
  });

  describe('コンストラクタ', () => {
    it('LoggerとMetadataManagerが正しく注入されること', () => {
      // TDD Red Phase: サービスがまだ存在しないため、このテストは失敗する
      expect(operationLogService).toBeDefined();
      expect(operationLogService).toBeInstanceOf(OperationLogService);
    });
  });

  describe('formatLogMessage', () => {
    it('日時フォーマット（YYYY/MM/DD HH:mm:ss形式）が正しいこと', () => {
      // Arrange
      const operationInfo: OperationInfo = {
        operationType: 'ADD_ITEM',
        actionName: '項目追加'
      };
      const result: OperationResult = { success: true };
      const userId = 'test-user-123';
      const testDate = new Date('2024-01-01T12:00:00Z');

      // Act
      const formattedMessage = operationLogService.formatLogMessage(
        operationInfo,
        result,
        userId,
        testDate
      );

      // Assert
      expect(formattedMessage).toMatch(/^\[\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\]/);
      expect(formattedMessage).toContain('2024/01/01 12:00:00');
    });

    it('メンション形式（@ユーザー名）が正しいこと', () => {
      // Arrange
      const operationInfo: OperationInfo = {
        operationType: 'ADD_ITEM',
        actionName: '項目追加'
      };
      const result: OperationResult = { success: true };
      const userId = 'test-user-123';

      // Act
      const formattedMessage = operationLogService.formatLogMessage(
        operationInfo,
        result,
        userId
      );

      // Assert
      expect(formattedMessage).toContain('<@test-user-123>');
    });

    it('構造化されたログ形式が正しく、アイテム数や詳細が含まれないこと', () => {
      // Arrange
      const operationInfo: OperationInfo = {
        operationType: 'ADD_ITEM',
        actionName: '項目追加'
      };
      const result: OperationResult = { success: true, affectedItems: 3 };
      const details: OperationDetails = {
        items: [
          { name: 'テスト項目1', quantity: 1, category: 'テスト' },
          { name: 'テスト項目2', quantity: 2, category: 'テスト' }
        ]
      };
      const userId = 'test-user-123';

      // Act
      const formattedMessage = operationLogService.formatLogMessage(
        operationInfo,
        result,
        userId,
        undefined,
        details
      );

      // Assert - 新仕様：項目数や詳細リストが含まれないこと
      expect(formattedMessage).toContain('項目追加');
      expect(formattedMessage).toContain('<@test-user-123>');
      expect(formattedMessage).not.toContain('アイテム数');
      expect(formattedMessage).not.toContain('項目数');
      expect(formattedMessage).not.toContain('テスト項目1');
      expect(formattedMessage).not.toContain('テスト項目2');
    });

    it('成功時（✅）のフォーマットが正しいこと', () => {
      // Arrange
      const operationInfo: OperationInfo = {
        operationType: 'ADD_ITEM',
        actionName: '項目追加'
      };
      const result: OperationResult = { success: true };
      const userId = 'test-user-123';

      // Act
      const formattedMessage = operationLogService.formatLogMessage(
        operationInfo,
        result,
        userId
      );

      // Assert
      expect(formattedMessage).toContain('✅');
      expect(formattedMessage).not.toContain('❌');
    });

    it('失敗時（❌）のフォーマットが正しいこと', () => {
      // Arrange
      const operationInfo: OperationInfo = {
        operationType: 'ADD_ITEM',
        actionName: '項目追加'
      };
      const result: OperationResult = { 
        success: false, 
        message: 'エラーが発生しました' 
      };
      const userId = 'test-user-123';

      // Act
      const formattedMessage = operationLogService.formatLogMessage(
        operationInfo,
        result,
        userId
      );

      // Assert
      expect(formattedMessage).toContain('❌');
      expect(formattedMessage).toContain('エラーが発生しました');
      expect(formattedMessage).not.toContain('✅');
    });
  });

  describe('logOperation', () => {
    it('正常系：ログ投稿が成功すること', async () => {
      // Arrange
      const channelId = 'test-channel-123';
      const operationInfo: OperationInfo = {
        operationType: 'ADD_ITEM',
        actionName: '項目追加'
      };
      const result: OperationResult = { success: true };
      const userId = 'test-user-123';

      // Act
      await operationLogService.logOperation(
        channelId,
        operationInfo,
        result,
        userId,
        mockClient as unknown as Client
      );

      // Assert
      expect(mockMetadataManager.getChannelMetadata).toHaveBeenCalledWith(channelId);
      expect(mockThread.send).toHaveBeenCalledWith(
        expect.stringContaining('✅')
      );
    });

    it('異常系：エラー時の非侵襲的動作（例外を投げない）を確認', async () => {
      // Arrange
      const channelId = 'test-channel-123';
      const operationInfo: OperationInfo = {
        operationType: 'ADD_ITEM',
        actionName: '項目追加'
      };
      const result: OperationResult = { success: true };
      const userId = 'test-user-123';
      
      mockThread.send.mockRejectedValue(new Error('Send failed'));

      // Act & Assert
      // 例外が投げられずに正常に完了することを確認
      await expect(
        operationLogService.logOperation(
          channelId,
          operationInfo,
          result,
          userId,
          mockClient as unknown as Client
        )
      ).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('操作ログの記録に失敗しました'),
        expect.any(Object)
      );
    });

    it('MetadataManagerからoperationLogThreadIdを正しく取得すること', async () => {
      // Arrange
      const channelId = 'test-channel-123';
      const operationInfo: OperationInfo = {
        operationType: 'ADD_ITEM',
        actionName: '項目追加'
      };
      const result: OperationResult = { success: true };
      const userId = 'test-user-123';

      // Act
      await operationLogService.logOperation(
        channelId,
        operationInfo,
        result,
        userId,
        mockClient as unknown as Client
      );

      // Assert
      expect(mockMetadataManager.getChannelMetadata).toHaveBeenCalledWith(channelId);
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('test-thread-456');
    });

    it('operationLogThreadIdが存在しない場合、ログ記録をスキップすること', async () => {
      // Arrange
      const channelId = 'test-channel-123';
      const operationInfo: OperationInfo = {
        operationType: 'ADD_ITEM',
        actionName: '項目追加'
      };
      const result: OperationResult = { success: true };
      const userId = 'test-user-123';

      mockMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: {
          channelId: 'test-channel-123',
          messageId: 'test-message-456',
          listTitle: 'Test List',
          // operationLogThreadId がない
        }
      });

      // Act
      await operationLogService.logOperation(
        channelId,
        operationInfo,
        result,
        userId,
        mockClient as unknown as Client
      );

      // Assert - 新仕様：スレッド作成もログ投稿も行わない
      expect(mockTextChannel.threads.create).not.toHaveBeenCalled();
      expect(mockMetadataManager.updateChannelMetadata).not.toHaveBeenCalled();
      expect(mockThread.send).not.toHaveBeenCalled();
    });
  });

  describe('createLogThread', () => {
    it('Discord.jsのstartThread()が呼び出されること', async () => {
      // Arrange
      const channelId = 'test-channel-123';

      // Act
      const result = await operationLogService.createLogThread(
        channelId,
        mockClient as unknown as Client
      );

      // Assert
      expect(mockClient.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(mockTextChannel.threads.create).toHaveBeenCalledWith({
        name: '操作ログ',
        autoArchiveDuration: 60
      });
      expect(result).toBe(mockThread);
    });

    it('スレッド名が「操作ログ」になること', async () => {
      // Arrange
      const channelId = 'test-channel-123';

      // Act
      await operationLogService.createLogThread(
        channelId,
        mockClient as unknown as Client
      );

      // Assert
      expect(mockTextChannel.threads.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '操作ログ'
        })
      );
    });

    it('チャンネルが見つからない場合はエラーを投げること', async () => {
      // Arrange
      const channelId = 'non-existent-channel';
      mockClient.channels.fetch.mockResolvedValue(null);

      // Act & Assert
      await expect(
        operationLogService.createLogThread(
          channelId,
          mockClient as unknown as Client
        )
      ).rejects.toThrow('チャンネルが見つかりません');
    });

    it('チャンネルがテキストチャンネルでない場合はエラーを投げること', async () => {
      // Arrange
      const channelId = 'voice-channel-123';
      const mockVoiceChannel = {
        id: 'voice-channel-123',
        type: ChannelType.GuildVoice
      };
      mockClient.channels.fetch.mockResolvedValue(mockVoiceChannel);

      // Act & Assert
      await expect(
        operationLogService.createLogThread(
          channelId,
          mockClient as unknown as Client
        )
      ).rejects.toThrow('テキストチャンネルではありません');
    });
  });
});