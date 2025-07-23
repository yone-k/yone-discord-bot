import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction } from 'discord.js';
import { Logger, LogLevel } from '../../src/utils/logger';
import { InitListButtonHandler } from '../../src/buttons/InitListButtonHandler';
import { InitListCommand } from '../../src/commands/InitListCommand';
import { ButtonHandlerContext } from '../../src/base/BaseButtonHandler';

describe('InitListButtonHandler', () => {
  let handler: InitListButtonHandler;
  let logger: Logger;
  let mockInitListCommand: InitListCommand;
  let mockInteraction: ButtonInteraction;
  let context: ButtonHandlerContext;

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG);
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    // InitListCommandのモック
    mockInitListCommand = {
      execute: vi.fn()
    } as any;

    // ボタンインタラクションのモック（optionsプロパティは存在しない）
    mockInteraction = {
      customId: 'init-list-button',
      user: {
        id: 'user123',
        bot: false
      },
      guildId: 'guild456',
      channelId: 'channel789',
      channel: { name: 'test-channel' },
      client: {},
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined)
      // options プロパティは ButtonInteraction には存在しない
    } as any;

    context = {
      interaction: mockInteraction
    };

    handler = new InitListButtonHandler(logger, mockInitListCommand);
  });

  describe('executeAction', () => {
    it('ボタンインタラクションでエラーが発生することを確認する（Red フェーズ）', async () => {
      // InitListCommandのexecuteメソッドで「Cannot read properties of undefined」エラーをシミュレート
      const error = new Error('Cannot read properties of undefined (reading \'getString\')');
      mockInitListCommand.execute = vi.fn().mockRejectedValue(error);

      // ボタンインタラクションから呼び出されるため、エラーが発生するはず
      await expect(handler['executeAction'](context)).rejects.toThrow(/Cannot read properties of undefined/);
    });
  });
});