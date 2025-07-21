import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ButtonManager } from '../../src/services/ButtonManager';
import { BaseButtonHandler, ButtonHandlerContext } from '../../src/base/BaseButtonHandler';
import { Logger, LogLevel } from '../../src/utils/logger';
import { ButtonInteraction } from 'discord.js';

// テスト用のButtonHandler
class TestButtonHandler extends BaseButtonHandler {
  constructor(customId: string, logger: Logger) {
    super(customId, logger);
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<void> {
    // テスト用の実装
    await context.interaction.reply({
      content: 'Test action executed',
      ephemeral: true
    });
  }
}

describe('ButtonManager', () => {
  let buttonManager: ButtonManager;
  let logger: Logger;
  let testHandler: TestButtonHandler;
  let mockInteraction: Partial<ButtonInteraction>;

  beforeEach(() => {
    logger = new Logger(LogLevel.ERROR); // エラーレベルでログを抑制
    buttonManager = new ButtonManager(logger);
    testHandler = new TestButtonHandler('test-button', logger);

    mockInteraction = {
      customId: 'test-button',
      user: {
        id: 'test-user-id',
        bot: false
      } as any,
      guildId: 'test-guild-id',
      replied: false,
      deferred: false,
      reply: vi.fn().mockResolvedValue(undefined)
    };
  });

  describe('ハンドラー登録', () => {
    it('ボタンハンドラーを正常に登録できる', () => {
      buttonManager.registerHandler(testHandler);
      
      const handlers = buttonManager.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toBe(testHandler);
    });

    it('同じcustomIdのハンドラーを重複登録しようとすると警告が出る', () => {
      const loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      
      buttonManager.registerHandler(testHandler);
      buttonManager.registerHandler(testHandler);
      
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already registered'),
        expect.any(Object)
      );
      
      const handlers = buttonManager.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
    });
  });

  describe('ボタンインタラクション処理', () => {
    beforeEach(() => {
      buttonManager.registerHandler(testHandler);
    });

    it('登録されたハンドラーのボタンが押された場合、適切にアクションが実行される', async () => {
      await buttonManager.handleButtonInteraction(mockInteraction as ButtonInteraction);
      
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'Test action executed',
        ephemeral: true
      });
    });

    it('未登録のcustomIdのボタンが押された場合、デフォルトの応答を返す', async () => {
      mockInteraction.customId = 'unknown-button';
      
      await buttonManager.handleButtonInteraction(mockInteraction as ButtonInteraction);
      
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'この操作は現在利用できません。',
        ephemeral: true
      });
    });

    it('ボットユーザーのボタン操作は無視される', async () => {
      (mockInteraction.user as any).bot = true;
      
      await buttonManager.handleButtonInteraction(mockInteraction as ButtonInteraction);
      
      expect(mockInteraction.reply).not.toHaveBeenCalled();
    });
  });

  describe('ハンドラー管理', () => {
    it('customIdでハンドラーを取得できる', () => {
      buttonManager.registerHandler(testHandler);
      
      const retrieved = buttonManager.getHandlerByCustomId('test-button');
      expect(retrieved).toBe(testHandler);
    });

    it('存在しないcustomIdの場合はundefinedを返す', () => {
      const retrieved = buttonManager.getHandlerByCustomId('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('ハンドラーを登録解除できる', () => {
      buttonManager.registerHandler(testHandler);
      
      const unregistered = buttonManager.unregisterHandler('test-button');
      expect(unregistered).toBe(true);
      
      const handlers = buttonManager.getRegisteredHandlers();
      expect(handlers).toHaveLength(0);
    });

    it('存在しないハンドラーの登録解除はfalseを返す', () => {
      const unregistered = buttonManager.unregisterHandler('non-existent');
      expect(unregistered).toBe(false);
    });
  });
});