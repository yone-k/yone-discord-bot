import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction, ModalBuilder } from 'discord.js';
import { Logger, LogLevel } from '../../src/utils/logger';
import { AddListButtonHandler } from '../../src/buttons/AddListButtonHandler';
import { ButtonHandlerContext } from '../../src/base/BaseButtonHandler';

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
    it('should show add-list modal when button is clicked', async () => {
      await handler['executeAction'](context);

      expect(mockInteraction.showModal).toHaveBeenCalledTimes(1);
      
      // モーダルが正しく構成されているかチェック
      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      expect(modalCall).toBeInstanceOf(ModalBuilder);
    });

    it('should log info when showing modal', async () => {
      const infoSpy = vi.spyOn(logger, 'info');
      
      await handler['executeAction'](context);

      expect(infoSpy).toHaveBeenCalledWith('Showing add-list modal', {
        channelId: 'channel789',
        userId: 'user123'
      });
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
});