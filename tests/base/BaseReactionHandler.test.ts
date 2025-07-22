import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageReaction, User, ModalBuilder } from 'discord.js';
import { Logger } from '../../src/utils/logger';
import { BaseReactionHandler, ReactionHandlerContext } from '../../src/base/BaseReactionHandler';

class TestReactionHandler extends BaseReactionHandler {
  constructor(logger: Logger) {
    super('test-emoji', logger);
  }

  protected async createModal(_context: ReactionHandlerContext): Promise<ModalBuilder> {
    const modal = new ModalBuilder()
      .setCustomId('test-modal')
      .setTitle('Test Modal');
    return modal;
  }
}

describe('BaseReactionHandler', () => {
  let handler: TestReactionHandler;
  let logger: Logger;
  let mockReaction: MessageReaction;
  let mockUser: User;
  let context: ReactionHandlerContext;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as any;

    mockUser = {
      id: 'user123',
      bot: false
    } as any;

    mockReaction = {
      emoji: { name: 'test-emoji' },
      message: {
        id: 'message123',
        author: { id: 'bot456' },
        embeds: [{ title: 'Test Embed' }]
      },
      users: {
        remove: vi.fn()
      }
    } as any;

    context = {
      reaction: mockReaction,
      user: mockUser
    };

    handler = new TestReactionHandler(logger);
  });

  describe('handle', () => {
    it('should handle valid reaction from non-bot user', async () => {
      const showModalSpy = vi.spyOn(handler as any, 'showModal').mockResolvedValue(undefined);
      
      await handler.handle(context);

      expect(showModalSpy).toHaveBeenCalledWith(context);
      expect(mockReaction.users.remove).toHaveBeenCalledWith(mockUser.id);
    });

    it('should ignore reaction from bot user', async () => {
      mockUser.bot = true;
      const showModalSpy = vi.spyOn(handler as any, 'showModal').mockResolvedValue(undefined);

      await handler.handle(context);

      expect(showModalSpy).not.toHaveBeenCalled();
      expect(mockReaction.users.remove).not.toHaveBeenCalled();
    });

    it('should ignore reaction with wrong emoji', async () => {
      mockReaction.emoji.name = 'wrong-emoji';
      const showModalSpy = vi.spyOn(handler as any, 'showModal').mockResolvedValue(undefined);

      await handler.handle(context);

      expect(showModalSpy).not.toHaveBeenCalled();
      expect(mockReaction.users.remove).not.toHaveBeenCalled();
    });

    it('should handle error during modal display', async () => {
      const error = new Error('Modal error');
      vi.spyOn(handler as any, 'showModal').mockRejectedValue(error);

      await handler.handle(context);

      expect(logger.error).toHaveBeenCalledWith(
        `Failed to handle reaction for emoji "${handler.getEmojiName()}"`,
        expect.objectContaining({ error: error.message })
      );
      expect(mockReaction.users.remove).toHaveBeenCalledWith(mockUser.id);
    });
  });

  describe('shouldHandle', () => {
    it('should return true for matching emoji from non-bot user', () => {
      const result = handler.shouldHandle(context);
      expect(result).toBe(true);
    });

    it('should return false for bot user', () => {
      mockUser.bot = true;
      const result = handler.shouldHandle(context);
      expect(result).toBe(false);
    });

    it('should return false for wrong emoji', () => {
      mockReaction.emoji.name = 'wrong-emoji';
      const result = handler.shouldHandle(context);
      expect(result).toBe(false);
    });
  });

  describe('getEmojiName', () => {
    it('should return the emoji name', () => {
      expect(handler.getEmojiName()).toBe('test-emoji');
    });
  });
});