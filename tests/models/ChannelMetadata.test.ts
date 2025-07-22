import { describe, it, expect } from 'vitest';
import { ChannelMetadata, createChannelMetadata, validateChannelMetadata, updateSyncTime, generateListTitle } from '../../src/models/ChannelMetadata';

describe('ChannelMetadata', () => {
  describe('interface validation', () => {
    it('should create a valid ChannelMetadata object', () => {
      const now = new Date();
      const metadata: ChannelMetadata = {
        channelId: '123456789012345678',
        messageId: '987654321098765432',
        listTitle: '買い物リスト',
        lastSyncTime: now
      };

      expect(metadata.channelId).toBe('123456789012345678');
      expect(metadata.messageId).toBe('987654321098765432');
      expect(metadata.listTitle).toBe('買い物リスト');
      expect(metadata.lastSyncTime).toBe(now);
    });

    it('should require all mandatory fields', () => {
      const now = new Date();
      const metadata: ChannelMetadata = {
        channelId: '123456789012345678',
        messageId: '987654321098765432',
        listTitle: 'テストリスト',
        lastSyncTime: now
      };

      expect(metadata).toHaveProperty('channelId');
      expect(metadata).toHaveProperty('messageId');
      expect(metadata).toHaveProperty('listTitle');
      expect(metadata).toHaveProperty('lastSyncTime');
    });
  });

  describe('createChannelMetadata helper', () => {
    it('should create ChannelMetadata with current JST timestamp', () => {
      const result = createChannelMetadata(
        '123456789012345678',
        '987654321098765432',
        '今日の買い物'
      );

      expect(result.channelId).toBe('123456789012345678');
      expect(result.messageId).toBe('987654321098765432');
      expect(result.listTitle).toBe('今日の買い物');
      expect(result.lastSyncTime).toBeInstanceOf(Date);
      expect(Math.abs(result.lastSyncTime.getTime() - Date.now())).toBeLessThan(1000);
    });

    it('should trim whitespace from listTitle', () => {
      const result = createChannelMetadata(
        '123456789012345678',
        '987654321098765432',
        '  タスクリスト  '
      );

      expect(result.listTitle).toBe('タスクリスト');
    });
  });

  describe('validateChannelMetadata helper', () => {
    it('should validate a correct ChannelMetadata', () => {
      const validMetadata: ChannelMetadata = {
        channelId: '123456789012345678',
        messageId: '987654321098765432',
        listTitle: '買い物リスト',
        lastSyncTime: new Date()
      };

      expect(() => validateChannelMetadata(validMetadata)).not.toThrow();
    });

    it('should throw error for invalid channelId', () => {
      const invalidMetadata: ChannelMetadata = {
        channelId: '',
        messageId: '987654321098765432',
        listTitle: 'テストリスト',
        lastSyncTime: new Date()
      };

      expect(() => validateChannelMetadata(invalidMetadata)).toThrow('チャンネルIDは必須です');
    });

    it('should throw error for invalid messageId', () => {
      const invalidMetadata: ChannelMetadata = {
        channelId: '123456789012345678',
        messageId: '',
        listTitle: 'テストリスト',
        lastSyncTime: new Date()
      };

      expect(() => validateChannelMetadata(invalidMetadata)).toThrow('メッセージIDは必須です');
    });

    it('should throw error for empty listTitle', () => {
      const invalidMetadata: ChannelMetadata = {
        channelId: '123456789012345678',
        messageId: '987654321098765432',
        listTitle: '',
        lastSyncTime: new Date()
      };

      expect(() => validateChannelMetadata(invalidMetadata)).toThrow('リストタイトルは必須です');
    });

  });

  describe('updateSyncTime helper', () => {
    it('should update lastSyncTime to current time', () => {
      const originalTime = new Date('2025-01-01T00:00:00Z');
      const metadata: ChannelMetadata = {
        channelId: '123456789012345678',
        messageId: '987654321098765432',
        listTitle: 'テストリスト',
        lastSyncTime: originalTime
      };

      const updated = updateSyncTime(metadata);

      expect(updated.channelId).toBe(metadata.channelId);
      expect(updated.messageId).toBe(metadata.messageId);
      expect(updated.listTitle).toBe(metadata.listTitle);
      expect(updated.lastSyncTime).not.toBe(originalTime);
      expect(Math.abs(updated.lastSyncTime.getTime() - Date.now())).toBeLessThan(1000);
    });
  });

  describe('generateListTitle helper', () => {
    it('should generate title with channel name', () => {
      const result = generateListTitle('買い物', '123456789012345678');
      expect(result).toBe('買い物リスト');
    });

    it('should trim channel name before generating title', () => {
      const result = generateListTitle('  買い物  ', '123456789012345678');
      expect(result).toBe('買い物リスト');
    });

    it('should use channel ID when channel name is null', () => {
      const result = generateListTitle(null, '123456789012345678');
      expect(result).toBe('123456789012345678');
    });

    it('should use channel ID when channel name is empty', () => {
      const result = generateListTitle('', '123456789012345678');
      expect(result).toBe('123456789012345678');
    });

    it('should use channel ID when channel name is whitespace only', () => {
      const result = generateListTitle('   ', '123456789012345678');
      expect(result).toBe('123456789012345678');
    });
  });
});