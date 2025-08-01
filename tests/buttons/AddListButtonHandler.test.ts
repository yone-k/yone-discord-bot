import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction, ModalBuilder } from 'discord.js';
import { Logger, LogLevel } from '../../src/utils/logger';
import { AddListButtonHandler } from '../../src/buttons/AddListButtonHandler';
import { ButtonHandlerContext } from '../../src/base/BaseButtonHandler';
import { OperationInfo } from '../../src/models/types/OperationLog';

describe('AddListButtonHandler', () => {
  let handler: AddListButtonHandler;
  let logger: Logger;
  let mockInteraction: ButtonInteraction;
  let context: ButtonHandlerContext;

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG);
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    // ボタンインタラクションのモック
    mockInteraction = {
      customId: 'add-list-button',
      user: {
        id: 'user123',
        bot: false
      },
      guildId: 'guild456',
      channelId: 'channel789',
      channel: { name: 'test-channel' },
      client: {},
      showModal: vi.fn().mockResolvedValue(undefined)
    } as any;

    context = {
      interaction: mockInteraction
    };

    handler = new AddListButtonHandler(logger);
  });

  describe('constructor', () => {
    it('should create handler with correct customId', () => {
      expect(handler.getCustomId()).toBe('add-list-button');
    });
  });

  describe('executeAction', () => {
    it('should show add-list modal when button is clicked and return success result', async () => {
      const result = await handler['executeAction'](context);

      expect(mockInteraction.showModal).toHaveBeenCalledTimes(1);
      
      // モーダルが正しく構成されているかチェック
      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      expect(modalCall).toBeInstanceOf(ModalBuilder);
      
      // OperationResultをチェック
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBe('追加モーダルを表示しました');
    });

    it('should log info when showing modal', async () => {
      const infoSpy = vi.spyOn(logger, 'info');
      
      const result = await handler['executeAction'](context);

      expect(infoSpy).toHaveBeenCalledWith('Showing add-list modal', {
        channelId: 'channel789',
        userId: 'user123'
      });
      
      expect(result.success).toBe(true);
    });
  });

  describe('shouldHandle', () => {
    it('should handle add-list-button customId', () => {
      expect(handler.shouldHandle(context)).toBe(true);
    });

    it('should not handle different customId', () => {
      mockInteraction.customId = 'different-button';
      expect(handler.shouldHandle(context)).toBe(false);
    });

    it('should not handle bot interactions', () => {
      mockInteraction.user.bot = true;
      expect(handler.shouldHandle(context)).toBe(false);
    });
  });

  describe('getOperationInfo', () => {
    it('should return operation info for item addition', () => {
      const operationInfo: OperationInfo = handler.getOperationInfo();
      
      expect(operationInfo).toEqual({
        operationType: 'add',
        actionName: 'アイテム追加'
      });
    });
  });

  describe('executeAction with operation logging', () => {
    it('should return OperationResult when showing modal', async () => {
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBe('追加モーダルを表示しました');
    });

    it('should include basic operation details when modal is shown', async () => {
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      
      // モーダル表示時のプレースホルダー値
      expect(result.affectedItems).toBe(1);
      expect(result.details?.items).toHaveLength(1);
      expect(result.details.items[0]).toEqual({
        name: '新しいアイテム',
        quantity: 1,
        category: 'その他',
        until: undefined
      });
    });

    it('should handle modal display failure', async () => {
      const mockError = new Error('Modal display failed');
      mockInteraction.showModal = vi.fn().mockRejectedValue(mockError);
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBe(mockError);
      expect(result.message).toBe('モーダル表示に失敗しました');
    });
  });
});