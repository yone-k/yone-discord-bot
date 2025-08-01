import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ConfirmationModalHandler } from '../../src/modals/ConfirmationModalHandler';
import { Logger } from '../../src/utils/logger';
import { ModalHandlerContext } from '../../src/base/BaseModalHandler';
import { ModalSubmitInteraction } from 'discord.js';

// Mock classes
class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('ConfirmationModalHandler', () => {
  let handler: ConfirmationModalHandler;
  let mockLogger: MockLogger;
  let mockContext: ModalHandlerContext;
  let mockInteraction: ModalSubmitInteraction;
  let mockCallback: vi.Mock;

  beforeEach(() => {
    mockLogger = new MockLogger();
    mockCallback = vi.fn().mockResolvedValue('テスト処理が完了しました。');
    handler = new ConfirmationModalHandler(mockLogger as unknown as Logger, mockCallback);

    mockInteraction = {
      customId: 'confirmation-modal',
      user: {
        id: 'test-user-id'
      },
      guildId: 'test-guild-id',
      channelId: 'test-channel-id',
      channel: {} as any,
      guild: {} as any,
      deferReply: vi.fn(),
      editReply: vi.fn()
    } as any;

    mockContext = {
      interaction: mockInteraction
    };
  });

  describe('コンストラクタ', () => {
    test('customIdが"confirmation-modal"に設定される', () => {
      expect(handler.getCustomId()).toBe('confirmation-modal');
    });

    test('deleteOnSuccessがtrueに設定される', () => {
      expect((handler as any).deleteOnSuccess).toBe(true);
    });

    test('ephemeralがデフォルトでtrueに設定される', () => {
      expect((handler as any).ephemeral).toBe(true);
    });

    test('コールバック関数が正しく設定される', () => {
      expect((handler as any).actionCallback).toBe(mockCallback);
    });

    test('ephemeralをfalseに指定できる', () => {
      const handlerFalse = new ConfirmationModalHandler(mockLogger as unknown as Logger, mockCallback, false);
      expect((handlerFalse as any).ephemeral).toBe(false);
    });

    test('ephemeralをtrueに指定できる', () => {
      const handlerTrue = new ConfirmationModalHandler(mockLogger as unknown as Logger, mockCallback, true);
      expect((handlerTrue as any).ephemeral).toBe(true);
    });
  });

  describe('shouldHandle', () => {
    test('customIdが一致する場合はtrue', () => {
      expect(handler.shouldHandle(mockContext)).toBe(true);
    });

    test('customIdが一致しない場合はfalse', () => {
      mockInteraction.customId = 'other-modal';
      expect(handler.shouldHandle(mockContext)).toBe(false);
    });
  });

  describe('executeAction - コールバック実行', () => {
    test('コールバック関数が正常に実行される', async () => {
      await handler.handle(mockContext);

      expect(mockCallback).toHaveBeenCalledWith(mockContext);
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: 'テスト処理が完了しました。'
      });
    });

    test('コールバックでエラーが発生した場合はdeleteOnSuccessにより処理完了メッセージ表示', async () => {
      mockCallback.mockRejectedValue(new Error('コールバック処理でエラー'));

      await handler.handle(mockContext);

      // deleteOnSuccess=trueのため、エラーの場合でも「処理が完了しました。」が表示される
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '処理が完了しました。'
      });
    });
  });

  describe('getSuccessMessage', () => {
    test('成功メッセージを返す', () => {
      expect((handler as any).getSuccessMessage()).toBe('処理が完了しました。');
    });
  });

  describe('エラーハンドリング', () => {
    test('コールバック関数が未設定の場合はdeleteOnSuccessにより処理完了メッセージ表示', async () => {
      const handlerWithoutCallback = new ConfirmationModalHandler(mockLogger as unknown as Logger, undefined as any);
      
      await handlerWithoutCallback.handle(mockContext);

      // executeActionがresult.success = falseで返しても、deleteOnSuccess=trueのため処理完了メッセージが表示される
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '処理が完了しました。'
      });
    });
  });
});