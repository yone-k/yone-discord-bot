import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalSubmitInteraction } from 'discord.js';
import { Logger } from '../../src/utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../../src/base/BaseModalHandler';

class TestModalHandler extends BaseModalHandler {
  constructor(logger: Logger, ephemeral = true, deleteOnSuccess = false) {
    super('test-modal', logger);
    this.ephemeral = ephemeral;
    this.deleteOnSuccess = deleteOnSuccess;
  }

  protected async executeAction(_context: ModalHandlerContext): Promise<void> {
    // テスト用の最小実装
  }

  protected getSuccessMessage(): string {
    return '✅ テストが完了しました';
  }
}

describe('BaseModalHandler', () => {
  let handler: TestModalHandler;
  let logger: Logger;
  let mockInteraction: ModalSubmitInteraction;
  let context: ModalHandlerContext;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as any;

    mockInteraction = {
      customId: 'test-modal',
      user: {
        id: 'user123',
        bot: false
      },
      guildId: 'guild456',
      channelId: 'channel789',
      reply: vi.fn(),
      editReply: vi.fn(),
      followUp: vi.fn(),
      deferReply: vi.fn()
    } as any;

    context = {
      interaction: mockInteraction
    };

    handler = new TestModalHandler(logger);
  });

  describe('handle', () => {
    it('should handle valid modal submission', async () => {
      const executeActionSpy = vi.spyOn(handler as any, 'executeAction').mockResolvedValue(undefined);
      
      await handler.handle(context);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(executeActionSpy).toHaveBeenCalledWith(context);
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '✅ テストが完了しました'
      });
    });

    it('should handle execution error', async () => {
      const error = new Error('Execution failed');
      vi.spyOn(handler as any, 'executeAction').mockRejectedValue(error);

      await handler.handle(context);

      expect(logger.error).toHaveBeenCalledWith(
        `Failed to handle modal submission for customId "${handler.getCustomId()}"`,
        expect.objectContaining({ error: error.message })
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ 処理中にエラーが発生しました。しばらく時間を置いてから再試行してください。'
      });
    });

    it('should handle reply error', async () => {
      const executeActionSpy = vi.spyOn(handler as any, 'executeAction').mockResolvedValue(undefined);
      const replyError = new Error('Reply failed');
      mockInteraction.editReply = vi.fn().mockRejectedValue(replyError);

      await handler.handle(context);

      expect(executeActionSpy).toHaveBeenCalledWith(context);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send modal response',
        expect.objectContaining({ error: replyError.message })
      );
    });
  });

  describe('shouldHandle', () => {
    it('should return true for matching customId', () => {
      const result = handler.shouldHandle(context);
      expect(result).toBe(true);
    });

    it('should return false for wrong customId', () => {
      mockInteraction.customId = 'wrong-modal';
      const result = handler.shouldHandle(context);
      expect(result).toBe(false);
    });
  });

  describe('getCustomId', () => {
    it('should return the customId', () => {
      expect(handler.getCustomId()).toBe('test-modal');
    });
  });

  describe('ephemeral option', () => {
    it('should use ephemeral: false when set to false', async () => {
      const handler = new TestModalHandler(logger, false, false);
      vi.spyOn(handler as any, 'executeAction').mockResolvedValue(undefined);
      
      await handler.handle(context);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    });

    it('should use ephemeral: true by default', async () => {
      const handler = new TestModalHandler(logger);
      vi.spyOn(handler as any, 'executeAction').mockResolvedValue(undefined);
      
      await handler.handle(context);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });
  });

  describe('deleteOnSuccess option', () => {
    beforeEach(() => {
      const mockMessage = { delete: vi.fn().mockResolvedValue(undefined) };
      mockInteraction.fetchReply = vi.fn().mockResolvedValue(mockMessage);
    });

    it('should delete message when deleteOnSuccess is true', async () => {
      const handler = new TestModalHandler(logger, true, true);
      vi.spyOn(handler as any, 'executeAction').mockResolvedValue(undefined);
      
      await handler.handle(context);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({ content: '処理が完了しました。' });
      expect(mockInteraction.fetchReply).toHaveBeenCalled();
    });

    it('should not delete message when deleteOnSuccess is false', async () => {
      const handler = new TestModalHandler(logger, true, false);
      vi.spyOn(handler as any, 'executeAction').mockResolvedValue(undefined);
      
      await handler.handle(context);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({ content: '✅ テストが完了しました' });
      expect(mockInteraction.fetchReply).not.toHaveBeenCalled();
    });
  });
});