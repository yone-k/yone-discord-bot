import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelConfigurationManager } from '../../src/services/ChannelConfigurationManager';
import { ChannelMetadata } from '../../src/models/ChannelMetadata';

// Discord.jsのモック
const mockChannel = {
  id: 'test-channel-123',
  send: vi.fn(),
  messages: {
    fetch: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn()
  }
};

const mockMessage = {
  id: 'test-message-456',
  pin: vi.fn(),
  unpin: vi.fn(),
  edit: vi.fn(),
  delete: vi.fn()
};

describe('ChannelConfigurationManager', () => {
  let manager: ChannelConfigurationManager;
  let testMetadata: ChannelMetadata;

  beforeEach(() => {
    manager = new ChannelConfigurationManager();
    testMetadata = {
      channelId: 'test-channel-123',
      messageId: 'test-message-456',
      listTitle: 'テストリスト',
      listType: 'shopping',
      lastSyncTime: new Date('2025-01-01T00:00:00Z')
    };
    vi.clearAllMocks();
  });

  describe('チャンネル設定の永続化', () => {
    it('設定を保存できる', async () => {
      await manager.saveConfiguration(testMetadata);
      const savedConfig = await manager.getConfiguration('test-channel-123');
      
      expect(savedConfig).toEqual(testMetadata);
    });

    it('存在しないチャンネルの設定を取得すると例外が発生する', async () => {
      await expect(manager.getConfiguration('non-existent-channel'))
        .rejects.toThrow('チャンネル設定が見つかりません');
    });

    it('設定を削除できる', async () => {
      await manager.saveConfiguration(testMetadata);
      await manager.deleteConfiguration('test-channel-123');
      
      await expect(manager.getConfiguration('test-channel-123'))
        .rejects.toThrow('チャンネル設定が見つかりません');
    });

    it('設定を更新できる', async () => {
      await manager.saveConfiguration(testMetadata);
      
      const updatedMetadata = {
        ...testMetadata,
        listTitle: '更新されたリスト',
        lastSyncTime: new Date('2025-01-02T00:00:00Z')
      };
      
      await manager.updateConfiguration(updatedMetadata);
      const savedConfig = await manager.getConfiguration('test-channel-123');
      
      expect(savedConfig.listTitle).toBe('更新されたリスト');
      expect(savedConfig.lastSyncTime).toEqual(new Date('2025-01-02T00:00:00Z'));
    });
  });

  describe('メッセージID管理', () => {
    it('メッセージIDを取得できる', async () => {
      await manager.saveConfiguration(testMetadata);
      const messageId = await manager.getMessageId('test-channel-123');
      
      expect(messageId).toBe('test-message-456');
    });

    it('メッセージIDを更新できる', async () => {
      await manager.saveConfiguration(testMetadata);
      await manager.updateMessageId('test-channel-123', 'new-message-789');
      
      const messageId = await manager.getMessageId('test-channel-123');
      expect(messageId).toBe('new-message-789');
    });

    it('存在しないチャンネルのメッセージIDを取得すると例外が発生する', async () => {
      await expect(manager.getMessageId('non-existent-channel'))
        .rejects.toThrow('チャンネル設定が見つかりません');
    });
  });

  describe('固定メッセージ管理', () => {
    it('固定メッセージを作成できる', async () => {
      mockChannel.send.mockResolvedValue(mockMessage);
      
      const messageId = await manager.createPinnedMessage(
        mockChannel as any,
        'テスト固定メッセージ'
      );
      
      expect(mockChannel.send).toHaveBeenCalledWith('テスト固定メッセージ');
      expect(mockMessage.pin).toHaveBeenCalled();
      expect(messageId).toBe('test-message-456');
    });

    it('固定メッセージを更新できる', async () => {
      mockChannel.messages.fetch.mockResolvedValue(mockMessage);
      
      await manager.updatePinnedMessage(
        mockChannel as any,
        'test-message-456',
        '更新されたメッセージ'
      );
      
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith('test-message-456');
      expect(mockMessage.edit).toHaveBeenCalledWith('更新されたメッセージ');
    });

    it('固定メッセージを削除できる', async () => {
      mockChannel.messages.fetch.mockResolvedValue(mockMessage);
      
      await manager.deletePinnedMessage(
        mockChannel as any,
        'test-message-456'
      );
      
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith('test-message-456');
      expect(mockMessage.unpin).toHaveBeenCalled();
      expect(mockMessage.delete).toHaveBeenCalled();
    });

    it('存在しないメッセージを更新しようとすると例外が発生する', async () => {
      mockChannel.messages.fetch.mockRejectedValue(new Error('Unknown Message'));
      
      await expect(manager.updatePinnedMessage(
        mockChannel as any,
        'non-existent-message',
        'テストメッセージ'
      )).rejects.toThrow('メッセージが見つかりません');
    });
  });

  describe('同期時間管理', () => {
    it('同期時間を更新できる', async () => {
      await manager.saveConfiguration(testMetadata);
      
      const newSyncTime = new Date('2025-01-03T12:00:00Z');
      await manager.updateSyncTime('test-channel-123');
      
      const updatedConfig = await manager.getConfiguration('test-channel-123');
      expect(updatedConfig.lastSyncTime.getTime()).toBeGreaterThan(testMetadata.lastSyncTime.getTime());
    });
  });

  describe('設定一覧取得', () => {
    it('全ての設定を取得できる', async () => {
      const metadata1 = { ...testMetadata, channelId: 'channel-1' };
      const metadata2 = { ...testMetadata, channelId: 'channel-2', listTitle: 'リスト2' };
      
      await manager.saveConfiguration(metadata1);
      await manager.saveConfiguration(metadata2);
      
      const allConfigs = await manager.getAllConfigurations();
      expect(allConfigs).toHaveLength(2);
      expect(allConfigs.find(c => c.channelId === 'channel-1')).toBeDefined();
      expect(allConfigs.find(c => c.channelId === 'channel-2')).toBeDefined();
    });

    it('設定が存在しない場合は空配列を返す', async () => {
      const allConfigs = await manager.getAllConfigurations();
      expect(allConfigs).toEqual([]);
    });
  });
});