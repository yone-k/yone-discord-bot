import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalSubmitInteraction } from 'discord.js';
import { Logger } from '../../src/utils/logger';
import { ModalManager } from '../../src/services/ModalManager';
import { BaseModalHandler } from '../../src/base/BaseModalHandler';
import { OperationResult } from '../../src/models/types/OperationLog';

class TestModalHandler extends BaseModalHandler {
  constructor(customId: string, logger: Logger) {
    super(customId, logger);
  }

  protected async executeAction(): Promise<OperationResult> {
    return { success: true };
  }

  protected getSuccessMessage(): string {
    return '✅ テスト完了';
  }
}

class PrefixModalHandler extends BaseModalHandler {
  constructor(customId: string, logger: Logger) {
    super(customId, logger);
  }

  public shouldHandle(context: any): boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
    return context.interaction.customId.startsWith(`${this.customId}:`);
  }

  protected async executeAction(): Promise<OperationResult> {
    return { success: true };
  }

  protected getSuccessMessage(): string {
    return '✅ テスト完了';
  }
}

describe('ModalManager', () => {
  let manager: ModalManager;
  let logger: Logger;
  let handler1: TestModalHandler;
  let handler2: TestModalHandler;
  let mockInteraction: ModalSubmitInteraction;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as any;

    handler1 = new TestModalHandler('init-list-modal', logger);
    handler2 = new TestModalHandler('refresh-modal', logger);

    mockInteraction = {
      customId: 'init-list-modal',
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

    manager = new ModalManager(logger);
  });

  describe('registerHandler', () => {
    it('should register a modal handler', () => {
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

    it('should log warning when registering duplicate customId', () => {
      const duplicateHandler = new TestModalHandler('init-list-modal', logger);
      
      manager.registerHandler(handler1);
      manager.registerHandler(duplicateHandler);
      
      expect(logger.warn).toHaveBeenCalledWith(
        'Modal handler for customId "init-list-modal" is already registered, skipping',
        expect.any(Object)
      );
    });
  });

  describe('handleModalSubmit', () => {
    it('should handle modal submission with matching handler', async () => {
      const handleSpy = vi.spyOn(handler1, 'handle').mockResolvedValue(undefined);
      manager.registerHandler(handler1);

      await manager.handleModalSubmit(mockInteraction);

      expect(handleSpy).toHaveBeenCalledWith({
        interaction: mockInteraction
      });
    });

    it('should not handle modal submission without matching handler', async () => {
      mockInteraction.customId = 'unknown-modal';
      manager.registerHandler(handler1);

      await manager.handleModalSubmit(mockInteraction);

      expect(logger.debug).toHaveBeenCalledWith(
        'No handler found for modal customId',
        expect.objectContaining({ customId: 'unknown-modal' })
      );
    });

    it('should handle modal submission with prefix handler', async () => {
      const prefixHandler = new PrefixModalHandler('remind-task-update-modal', logger);
      const handleSpy = vi.spyOn(prefixHandler, 'handle').mockResolvedValue(undefined);
      manager.registerHandler(prefixHandler);

      mockInteraction.customId = 'remind-task-update-modal:msg-1';
      await manager.handleModalSubmit(mockInteraction);

      expect(handleSpy).toHaveBeenCalledWith({
        interaction: mockInteraction
      });
    });

    it('should handle error from handler', async () => {
      const error = new Error('Handler error');
      vi.spyOn(handler1, 'handle').mockRejectedValue(error);
      manager.registerHandler(handler1);

      await manager.handleModalSubmit(mockInteraction);

      expect(logger.error).toHaveBeenCalledWith(
        'Error in modal handler',
        expect.objectContaining({ 
          error: error.message,
          customId: 'init-list-modal'
        })
      );
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
