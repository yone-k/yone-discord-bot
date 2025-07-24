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
  edit: vi.fn()
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
});