import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageManager } from '../../src/services/MessageManager';
import { EmbedBuilder, ChannelType } from 'discord.js';

// Discord.jsのモック
const mockClient = {
  channels: {
    fetch: vi.fn()
  }
};

const mockChannel = {
  id: 'test-channel-123',
  type: ChannelType.GuildText,
  send: vi.fn(),
  messages: {
    fetch: vi.fn()
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

// モックのモジュール
vi.mock('../../src/services/MetadataManager', () => ({
  MetadataManager: vi.fn().mockImplementation(() => ({
    getChannelMetadata: vi.fn().mockResolvedValue({ success: false }),
    createChannelMetadata: vi.fn().mockResolvedValue({ success: true }),
    updateChannelMetadata: vi.fn().mockResolvedValue({ success: true })
  }))
}));

vi.mock('../../src/services/ButtonConfigManager', () => ({
  ButtonConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      isButtonEnabled: vi.fn().mockReturnValue(false),
      getCommandButtons: vi.fn().mockReturnValue([])
    })
  }
}));

describe('MessageManager', () => {
  let messageManager: MessageManager;
  let testEmbed: EmbedBuilder;

  beforeEach(() => {
    messageManager = new MessageManager();
    testEmbed = new EmbedBuilder()
      .setTitle('テストリスト')
      .setDescription('テスト用のembedです');
    
    vi.clearAllMocks();
    
    // デフォルトのモック設定
    mockClient.channels.fetch.mockResolvedValue(mockChannel);
    mockChannel.send.mockResolvedValue(mockMessage);
    mockChannel.messages.fetch.mockResolvedValue(mockMessage);
    mockMessage.pin.mockResolvedValue(undefined);
    mockMessage.unpin.mockResolvedValue(undefined);
    mockMessage.edit.mockResolvedValue(mockMessage);
    mockMessage.startThread.mockResolvedValue(null);
    mockMessage.pinned = false;
  });

  describe('ensureMessagePinned', () => {
    it('メッセージがピン留めされていない場合はピン留めする', async () => {
      // Arrange
      mockMessage.pinned = false;

      // Act
      const result = await messageManager.ensureMessagePinned(
        'test-channel-123',
        'test-message-456',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockMessage.pin).toHaveBeenCalled();
    });

    it('メッセージが既にピン留めされている場合は何もしない', async () => {
      // Arrange
      mockMessage.pinned = true;

      // Act
      const result = await messageManager.ensureMessagePinned(
        'test-channel-123',
        'test-message-456',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockMessage.pin).not.toHaveBeenCalled();
    });

    it('メッセージが見つからない場合はエラーを返す', async () => {
      // Arrange
      mockChannel.messages.fetch.mockRejectedValue(new Error('Unknown Message'));

      // Act
      const result = await messageManager.ensureMessagePinned(
        'test-channel-123',
        'non-existent-message',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('メッセージが見つかりません');
    });

    it('チャンネルが見つからない場合はエラーを返す', async () => {
      // Arrange
      mockClient.channels.fetch.mockResolvedValue(null);

      // Act
      const result = await messageManager.ensureMessagePinned(
        'non-existent-channel',
        'test-message-456',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('チャンネルが見つかりません');
    });

    it('ピン留め処理でエラーが発生した場合はエラーを返す', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.pin.mockRejectedValue(new Error('Pin failed'));

      // Act
      const result = await messageManager.ensureMessagePinned(
        'test-channel-123',
        'test-message-456',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Failed to pin message');
    });
  });

  describe('createOrUpdateMessageWithMetadata (with pinning)', () => {
    it('新規メッセージを作成してピン留めする', async () => {
      // Arrange
      mockMessage.pinned = false;

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();
      expect(mockMessage.pin).toHaveBeenCalled();
    });

    it('メッセージ作成後のピン留めが失敗してもメッセージ作成は成功とする', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.pin.mockRejectedValue(new Error('Pin failed'));

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();
      expect(mockMessage.pin).toHaveBeenCalled();
    });
  });

  describe('createOrUpdateMessageWithMetadata (with operationLogThreadId)', () => {
    it('operationLogThreadIdパラメータを受け取れる', async () => {
      // Arrange
      mockMessage.pinned = false;
      const operationLogThreadId = 'operation-thread-123';

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        operationLogThreadId
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();
    });

    it('operationLogThreadIdがメタデータに保存される', async () => {
      // Arrange
      mockMessage.pinned = false;
      const operationLogThreadId = 'operation-thread-456';
      const mockMetadataManager = messageManager['metadataManager'];

      // Act
      await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        operationLogThreadId
      );

      // Assert
      expect(mockMetadataManager.createChannelMetadata).toHaveBeenCalledWith(
        'test-channel-123',
        expect.objectContaining({
          operationLogThreadId: 'operation-thread-456'
        })
      );
    });

    it('operationLogThreadIdが省略された場合は正常に動作する', async () => {
      // Arrange
      mockMessage.pinned = false;

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();
    });

    it('既存メタデータ更新時にoperationLogThreadIdが保持される', async () => {
      // Arrange
      mockMessage.pinned = false;
      const operationLogThreadId = 'operation-thread-789';
      const existingMetadata = {
        channelId: 'test-channel-123',
        messageId: 'old-message-id',
        listTitle: '古いタイトル',
        lastSyncTime: new Date(),
        defaultCategory: 'テスト',
        operationLogThreadId: 'old-thread-id'
      };
      
      const mockMetadataManager = messageManager['metadataManager'];
      mockMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: existingMetadata
      });

      // Act
      await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        operationLogThreadId
      );

      // Assert
      expect(mockMetadataManager.updateChannelMetadata).toHaveBeenCalledWith(
        'test-channel-123',
        expect.objectContaining({
          operationLogThreadId: 'operation-thread-789'
        })
      );
    });
  });

  describe('スレッド作成統合', () => {
    let mockThreadChannel: any;

    beforeEach(() => {
      mockThreadChannel = {
        id: 'thread-123',
        name: 'Operation Log',
        type: ChannelType.PublicThread,
        send: vi.fn()
      };
    });

    it('メッセージ作成後にスレッドが作成される', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.startThread = vi.fn().mockResolvedValue(mockThreadChannel);

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        undefined, // operationLogThreadId
        true // createOperationLogThread
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockMessage.startThread).toHaveBeenCalledWith({
        name: '操作ログ',
        autoArchiveDuration: 1440 // 24時間
      });
    });

    it('スレッド作成後にスレッドIDがメタデータに保存される', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.startThread = vi.fn().mockResolvedValue(mockThreadChannel);
      const mockMetadataManager = messageManager['metadataManager'];

      // Act
      await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        undefined, // operationLogThreadId
        true // createOperationLogThread
      );

      // Assert
      expect(mockMetadataManager.createChannelMetadata).toHaveBeenCalledWith(
        'test-channel-123',
        expect.objectContaining({
          operationLogThreadId: 'thread-123'
        })
      );
    });

    it('スレッド作成が失敗してもメッセージ作成は成功とする', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.startThread = vi.fn().mockRejectedValue(new Error('Thread creation failed'));

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        undefined, // operationLogThreadId
        true // createOperationLogThread
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockMessage.startThread).toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalled();
    });

    it('createOperationLogThreadがfalseの場合はスレッドを作成しない', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.startThread = vi.fn();

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        undefined, // operationLogThreadId
        false // createOperationLogThread
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockMessage.startThread).not.toHaveBeenCalled();
    });
  });
});