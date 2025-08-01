import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction } from 'discord.js';
import { Logger, LogLevel } from '../../src/utils/logger';
import { InitListButtonHandler } from '../../src/buttons/InitListButtonHandler';
import { InitListCommand } from '../../src/commands/InitListCommand';
import { ButtonHandlerContext } from '../../src/base/BaseButtonHandler';
import { OperationInfo } from '../../src/models/types/OperationLog';

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

    handler = new InitListButtonHandler(logger, undefined, undefined, mockInitListCommand);
  });

  describe('executeAction', () => {
    it('ボタンインタラクションでエラーが発生することを確認する（Red フェーズ）', async () => {
      // InitListCommandのexecuteメソッドで「Cannot read properties of undefined」エラーをシミュレート
      const error = new Error('Cannot read properties of undefined (reading \'getString\')');
      mockInitListCommand.execute = vi.fn().mockRejectedValue(error);

      // ボタンインタラクションから呼び出されるため、エラーが発生するはず（OperationResultでエラーを返す）
      const result = await handler['executeAction'](context);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toMatch(/Cannot read properties of undefined/);
    });
  });

  describe('getOperationInfo', () => {
    it('should return operation info for list initialization', () => {
      const operationInfo: OperationInfo = handler.getOperationInfo();
      
      expect(operationInfo).toEqual({
        operationType: 'init',
        actionName: 'リスト初期化'
      });
    });
  });

  describe('executeAction with operation logging', () => {
    it('should return OperationResult on successful initialization', async () => {
      mockInitListCommand.execute = vi.fn().mockResolvedValue(undefined);
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBe('リストを初期化しました');
    });

    it('should include initialized item count in operation details', async () => {
      mockInitListCommand.execute = vi.fn().mockResolvedValue(undefined);
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.affectedItems).toBe(5); // ハードコードされた値
      
      expect(result.details?.items).toHaveLength(5);
      expect(result.details?.items?.[0]).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          quantity: expect.any(Number),
          category: expect.any(String)
        })
      );
    });

    it('should handle initialization cancellation', async () => {
      const cancelError = new Error('User cancelled initialization');
      mockInitListCommand.execute = vi.fn().mockRejectedValue(cancelError);
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBe(cancelError);
      // cancelledを含むエラーメッセージの場合のみcancelReasonが設定される
      expect(result.details?.cancelReason).toBe('ユーザーによる初期化キャンセル');
    });

    it('should handle initialization failure', async () => {
      const mockError = new Error('Initialization failed');
      mockInitListCommand.execute = vi.fn().mockRejectedValue(mockError);
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBe(mockError);
      expect(result.message).toBe('初期化に失敗しました');
    });
  });
});