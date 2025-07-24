import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DeleteAllMessageLogic } from '../../src/services/DeleteAllMessageLogic';
import { Logger } from '../../src/utils/logger';
import { PermissionFlagsBits, Collection, Message } from 'discord.js';

// Mock classes
class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('DeleteAllMessageLogic', () => {
  let logic: DeleteAllMessageLogic;
  let mockLogger: MockLogger;

  beforeEach(() => {
    mockLogger = new MockLogger();
    logic = new DeleteAllMessageLogic(mockLogger as unknown as Logger);
  });

  describe('コンストラクタ', () => {
    test('loggerが正しく設定される', () => {
      expect((logic as any).logger).toBe(mockLogger);
    });
  });

  describe('権限チェック', () => {
    test('権限がない場合はエラーをthrow', async () => {
      const mockMember = {
        permissions: {
          has: vi.fn().mockReturnValue(false)
        }
      } as any;

      await expect(logic.checkPermissions(mockMember)).rejects.toThrow('メッセージを削除する権限がありません。');
      expect(mockMember.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.ManageMessages);
    });

    test('権限がある場合は正常終了', async () => {
      const mockMember = {
        permissions: {
          has: vi.fn().mockReturnValue(true)
        }
      } as any;

      await expect(logic.checkPermissions(mockMember)).resolves.not.toThrow();
      expect(mockMember.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.ManageMessages);
    });
  });

  describe('メッセージ削除処理', () => {
    test('削除対象がない場合は0を返す', async () => {
      const mockChannel = {
        messages: {
          fetch: vi.fn().mockResolvedValue(new Collection())
        }
      } as any;

      const result = await logic.deleteAllMessages(mockChannel, 'test-user-id');

      expect(result.deletedCount).toBe(0);
      expect(result.message).toBe('削除対象のメッセージはありませんでした。');
    });

    test('新しいメッセージ（14日以内）はbulkDeleteで削除', async () => {
      const mockChannel = {
        id: 'test-channel-id',
        bulkDelete: vi.fn(),
        messages: {
          fetch: vi.fn()
        }
      } as any;

      // 7日前のメッセージをモック
      const recentMessage = {
        id: 'recent-msg-1',
        createdTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 7
      };

      const messages = new Collection();
      messages.set('recent-msg-1', recentMessage as Message);

      const bulkDeletedMessages = new Collection();
      bulkDeletedMessages.set('recent-msg-1', recentMessage as Message);

      mockChannel.messages.fetch.mockResolvedValue(messages);
      mockChannel.bulkDelete.mockResolvedValue(bulkDeletedMessages);

      const result = await logic.deleteAllMessages(mockChannel, 'test-user-id');

      expect(mockChannel.bulkDelete).toHaveBeenCalled();
      expect(result.deletedCount).toBe(1);
      expect(result.message).toBe('1件のメッセージを削除しました。');
      expect(mockLogger.info).toHaveBeenCalledWith('Message deletion completed', {
        channelId: 'test-channel-id',
        deletedCount: 1,
        userId: 'test-user-id'
      });
    });

    test('古いメッセージ（14日超過）は個別削除', async () => {
      const mockChannel = {
        id: 'test-channel-id',
        messages: {
          fetch: vi.fn()
        }
      } as any;

      // 15日前のメッセージをモック
      const oldMessage = {
        id: 'old-msg-1',
        createdTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 15,
        delete: vi.fn().mockResolvedValue(undefined)
      };

      const messages = new Collection();
      messages.set('old-msg-1', oldMessage as any);

      mockChannel.messages.fetch.mockResolvedValue(messages);

      const result = await logic.deleteAllMessages(mockChannel, 'test-user-id');

      expect(oldMessage.delete).toHaveBeenCalled();
      expect(result.deletedCount).toBe(1);
      expect(result.message).toBe('1件のメッセージを削除しました。');
    });

    test('bulkDelete失敗時は個別削除にフォールバック', async () => {
      const mockChannel = {
        id: 'test-channel-id',
        bulkDelete: vi.fn().mockRejectedValue(new Error('Bulk delete failed')),
        messages: {
          fetch: vi.fn()
        }
      } as any;

      const recentMessage = {
        id: 'recent-msg-1',
        createdTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 7,
        delete: vi.fn().mockResolvedValue(undefined)
      };

      const messages = new Collection();
      messages.set('recent-msg-1', recentMessage as any);

      mockChannel.messages.fetch.mockResolvedValue(messages);

      const result = await logic.deleteAllMessages(mockChannel, 'test-user-id');

      expect(mockChannel.bulkDelete).toHaveBeenCalled();
      expect(recentMessage.delete).toHaveBeenCalled();
      expect(result.deletedCount).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith('Bulk delete failed, falling back to individual deletion', {
        error: 'Bulk delete failed',
        channelId: 'test-channel-id',
        messageCount: 1
      });
    });

    test('メッセージ取得でエラーが発生した場合', async () => {
      const mockChannel = {
        messages: {
          fetch: vi.fn().mockRejectedValue(new Error('Fetch failed'))
        }
      } as any;

      await expect(logic.deleteAllMessages(mockChannel, 'test-user-id')).rejects.toThrow('Failed to fetch messages: Fetch failed');
    });
  });

  describe('結果メッセージ生成', () => {
    test('0件の場合', () => {
      expect(logic.getResultMessage(0)).toBe('削除対象のメッセージはありませんでした。');
    });

    test('1件の場合', () => {
      expect(logic.getResultMessage(1)).toBe('1件のメッセージを削除しました。');
    });

    test('複数件の場合', () => {
      expect(logic.getResultMessage(10)).toBe('10件のメッセージを削除しました。');
    });
  });
});