import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageReaction, User } from 'discord.js';
import { Logger } from '../../src/utils/logger';
import { ReactionManager } from '../../src/services/ReactionManager';
import { BaseReactionHandler } from '../../src/base/BaseReactionHandler';

class TestReactionHandler extends BaseReactionHandler {
  constructor(emojiName: string, logger: Logger) {
    super(emojiName, logger);
  }

  protected async createModal(): Promise<any> {
    return {} as any;
  }
}

describe('ReactionManager', () => {
  let manager: ReactionManager;
  let logger: Logger;
  let handler1: TestReactionHandler;
  let handler2: TestReactionHandler;
  let mockReaction: MessageReaction;
  let mockUser: User;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as any;

    handler1 = new TestReactionHandler('📋', logger);
    handler2 = new TestReactionHandler('🔄', logger);

    mockUser = {
      id: 'user123',
      bot: false
    } as any;

    mockReaction = {
      emoji: { name: '📋' },
      message: {
        id: 'message123',
        author: { id: 'bot456' },
        embeds: [{ title: 'Test Embed' }]
      },
      users: {
        remove: vi.fn()
      }
    } as any;

    manager = new ReactionManager(logger);
  });

  describe('registerHandler', () => {
    it('should register a reaction handler', () => {
      manager.registerHandler(handler1);
      
      const handlers = manager.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toBe(handler1);
    });

    it('should register multiple handlers', () => {
      manager.registerHandler(handler1);
      manager.registerHandler(handler2);
      
      const handlers = manager.getRegisteredHandlers();
      expect(handlers).toHaveLength(2);
      expect(handlers).toContain(handler1);
      expect(handlers).toContain(handler2);
    });

    it('should not register the same handler twice', () => {
      manager.registerHandler(handler1);
      manager.registerHandler(handler1);
      
      const handlers = manager.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
    });

    it('should log warning when registering duplicate emoji', () => {
      const duplicateHandler = new TestReactionHandler('📋', logger);
      
      manager.registerHandler(handler1);
      manager.registerHandler(duplicateHandler);
      
      expect(logger.warn).toHaveBeenCalledWith(
        'Reaction handler for emoji "📋" is already registered, skipping',
        expect.any(Object)
      );
    });
  });

  describe('handleReaction', () => {
    it('should handle reaction with matching handler', async () => {
      const handleSpy = vi.spyOn(handler1, 'handle').mockResolvedValue(undefined);
      manager.registerHandler(handler1);

      await manager.handleReaction(mockReaction, mockUser);

      expect(handleSpy).toHaveBeenCalledWith({
        reaction: mockReaction,
        user: mockUser
      });
    });

    it('should not handle reaction without matching handler', async () => {
      mockReaction.emoji.name = '❌';
      manager.registerHandler(handler1);

      await manager.handleReaction(mockReaction, mockUser);

      expect(logger.debug).toHaveBeenCalledWith(
        'No handler found for reaction emoji',
        expect.objectContaining({ emoji: '❌' })
      );
    });

    it('should handle error from handler', async () => {
      const error = new Error('Handler error');
      vi.spyOn(handler1, 'handle').mockRejectedValue(error);
      manager.registerHandler(handler1);

      await manager.handleReaction(mockReaction, mockUser);

      expect(logger.error).toHaveBeenCalledWith(
        'Error in reaction handler',
        expect.objectContaining({ 
          error: error.message,
          emoji: '📋'
        })
      );
    });

    it('should continue processing even if one handler fails', async () => {
      const handler3 = new TestReactionHandler('📋', logger);
      const error = new Error('First handler error');
      
      vi.spyOn(handler1, 'handle').mockRejectedValue(error);
      const _handle3Spy = vi.spyOn(handler3, 'handle').mockResolvedValue(undefined);
      
      manager.registerHandler(handler1);
      
      await manager.handleReaction(mockReaction, mockUser);

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getRegisteredHandlers', () => {
    it('should return empty array initially', () => {
      expect(manager.getRegisteredHandlers()).toEqual([]);
    });

    it('should return registered handlers', () => {
      manager.registerHandler(handler1);
      manager.registerHandler(handler2);
      
      const handlers = manager.getRegisteredHandlers();
      expect(handlers).toHaveLength(2);
    });
  });
});