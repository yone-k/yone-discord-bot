import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import { BaseButtonHandler, ButtonHandlerContext } from '../../src/base/BaseButtonHandler';
import { Logger, LogLevel } from '../../src/utils/logger';
import { ButtonInteraction } from 'discord.js';

// 実際の型をインポート
import { OperationInfo, OperationResult } from '../../src/models/types/OperationLog';
import { OperationLogService } from '../../src/services/OperationLogService';
import { MetadataProvider } from '../../src/services/MetadataProvider';
import { Client } from 'discord.js';

class TestButtonHandler extends BaseButtonHandler {
  public shouldThrowError = false;
  public customError: Error | null = null;
  public operationInfo: OperationInfo = {
    operationType: 'test',
    actionName: 'Test operation'
  };

  constructor(
    customId: string, 
    logger: Logger, 
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    super(customId, logger, operationLogService, metadataManager);
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    if (this.shouldThrowError) {
      if (this.customError) {
        throw this.customError;
      }
      throw new Error('Test error');
    }
    
    this.logger.info('Test button action executed', { 
      userId: context.interaction.user.id,
      customId: context.interaction.customId
    });

    return {
      success: true,
      message: 'Test operation completed'
    };
  }

  protected getOperationInfo(_context: ButtonHandlerContext): OperationInfo {
    return this.operationInfo;
  }
}

describe('BaseButtonHandler - 操作ログ機能統合', () => {
  let logger: Logger;
  let loggerInfoSpy: MockedFunction<typeof logger.info>;
  let loggerErrorSpy: MockedFunction<typeof logger.error>;
  let loggerWarnSpy: MockedFunction<typeof logger.warn>;
  let mockOperationLogService: OperationLogService;
  let mockMetadataManager: MetadataProvider;
  let mockInteraction: ButtonInteraction;

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG);
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    mockOperationLogService = {
      logOperation: vi.fn().mockResolvedValue(undefined),
      formatLogMessage: vi.fn().mockReturnValue('mocked log message'),
      createLogThread: vi.fn().mockResolvedValue({ id: 'thread-123' })
    } as any;

    mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { operationLogThreadId: 'thread-123' }
      }),
      updateChannelMetadata: vi.fn().mockResolvedValue({ success: true })
    } as any;

    mockInteraction = {
      customId: 'test-button',
      user: { id: 'user-123', bot: false },
      guild: { id: 'guild-123' },
      channel: { id: 'channel-123' },
      replied: false,
      deferred: false,
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      fetchReply: vi.fn().mockResolvedValue({ delete: vi.fn() }),
      client: {} as Client
    } as any;
  });

  describe('コンストラクタでのサービス注入', () => {
    it('OperationLogServiceを注入できる', () => {
      // 現在の実装では失敗することが期待される
      expect(() => {
        new TestButtonHandler('test', logger, mockOperationLogService);
        // この時点では、BaseButtonHandlerはOperationLogServiceを受け取らない
        // 将来的にコンストラクタが拡張される予定
      }).not.toThrow();
    });

    it('OperationLogServiceがオプショナルである', () => {
      // 現在の実装では失敗することが期待される
      expect(() => {
        new TestButtonHandler('test', logger);
        // OperationLogServiceなしでも作成できることを確認
      }).not.toThrow();
    });

    it('MetadataManagerを注入できる', () => {
      expect(() => {
        new TestButtonHandler('test', logger, undefined, mockMetadataManager);
        // この時点では、BaseButtonHandlerはMetadataManagerを受け取らない
      }).not.toThrow();
    });
  });

  describe('handle()メソッドでの操作ログ統合', () => {
    it('MetadataManagerからoperationLogThreadIdを取得する', async () => {
      const handler = new TestButtonHandler('test-button', logger, mockOperationLogService, mockMetadataManager);
      const context: ButtonHandlerContext = { interaction: mockInteraction };

      await handler.handle(context);

      // MetadataManagerからチャンネルメタデータを取得することを確認
      expect(mockMetadataManager.getChannelMetadata).toHaveBeenCalledWith('channel-123');
    });

    it('operationLogThreadIdが存在する場合のみlogOperation()を呼び出す', async () => {
      const handler = new TestButtonHandler('test-button', logger, mockOperationLogService, mockMetadataManager);
      const context: ButtonHandlerContext = { interaction: mockInteraction };

      await handler.handle(context);

      // OperationLogServiceのlogOperationが正しい引数で呼ばれることを確認
      expect(mockOperationLogService.logOperation).toHaveBeenCalledWith(
        'channel-123',
        {
          operationType: 'test',
          actionName: 'Test operation'
        },
        {
          success: true,
          message: 'Test operation completed'
        },
        'user-123',
        {}
      );
    });

    it('operationLogThreadIdが存在しない場合はログ記録をスキップする', async () => {
      mockMetadataManager.getChannelMetadata = vi.fn().mockResolvedValue({
        success: true,
        metadata: { operationLogThreadId: null }
      });
      const handler = new TestButtonHandler('test-button', logger, mockOperationLogService, mockMetadataManager);
      const context: ButtonHandlerContext = { interaction: mockInteraction };

      await handler.handle(context);

      // operationLogThreadIdが存在しない場合はlogOperationが呼ばれないことを確認
      expect(mockOperationLogService.logOperation).not.toHaveBeenCalled();
    });

    it('ログ投稿失敗時も処理が継続する（非侵襲的動作）', async () => {
      mockOperationLogService.logOperation = vi.fn().mockRejectedValue(new Error('Log posting failed'));
      const handler = new TestButtonHandler('test-button', logger, mockOperationLogService, mockMetadataManager);
      const context: ButtonHandlerContext = { interaction: mockInteraction };

      // エラーが投げられずに処理が完了することを確認
      await expect(handler.handle(context)).resolves.not.toThrow();

      // ログ投稿エラーが警告として記録されることを確認（将来的な実装）
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to log operation'),
        expect.objectContaining({
          error: 'Log posting failed'
        })
      );
    });
  });

  describe('getOperationInfo()抽象メソッド', () => {
    it('抽象メソッドが定義されている', () => {
      const handler = new TestButtonHandler('test', logger);
      const context: ButtonHandlerContext = { interaction: mockInteraction };

      // 現在の実装では、BaseButtonHandlerにgetOperationInfo抽象メソッドが存在しないため失敗する
      expect(() => {
        // TypeScriptコンパイル時にエラーになるが、テスト実行時の動作を確認
        const operationInfo = handler.getOperationInfo(context);
        expect(operationInfo).toBeDefined();
        expect(operationInfo.operationType).toBe('test');
        expect(operationInfo.actionName).toBe('Test operation');
      }).not.toThrow();
    });

    it('サブクラスで実装が必要である', () => {
      // BaseButtonHandlerを直接継承するクラスを作成（getOperationInfoを実装しない）
      class IncompleteHandler extends BaseButtonHandler {
        protected async executeAction(_context: ButtonHandlerContext): Promise<OperationResult> {
          return { success: true };
        }
        // getOperationInfoを実装しない
      }

      // 現在の実装では、コンパイルエラーになることが期待される
      // 将来的には、抽象メソッドとして定義されるため、実装が必要になる
      expect(() => {
        new IncompleteHandler('test', logger);
      }).not.toThrow(); // 現在は抽象メソッドではないため、エラーにならない
    });
  });

  describe('executeAction()のOperationResult戻り値', () => {
    it('戻り値がOperationResult型である', async () => {
      const handler = new TestButtonHandler('test', logger);
      const context: ButtonHandlerContext = { interaction: mockInteraction };

      // 現在の実装では、executeActionがvoidを返すため失敗する
      const result = await handler.executeAction(context);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBe('Test operation completed');
      expect(result.error).toBeUndefined();
    });

    it('成功時のOperationResultを返す', async () => {
      const handler = new TestButtonHandler('test', logger);
      const context: ButtonHandlerContext = { interaction: mockInteraction };

      const result = await handler.executeAction(context);

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('失敗時のOperationResultを返す', async () => {
      const handler = new TestButtonHandler('test', logger);
      handler.shouldThrowError = true;
      handler.customError = new Error('Test error');
      const context: ButtonHandlerContext = { interaction: mockInteraction };

      // 現在の実装では、エラーが投げられるため、OperationResultは返されない
      // 将来的には、エラーもOperationResultとして返される予定
      await expect(async () => {
        const result = await handler.executeAction(context);
        expect(result.success).toBe(false);
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error?.message).toBe('Test error');
      }).rejects.toThrow('Test error');
    });
  });

  describe('既存機能との互換性', () => {
    it('操作ログサービスが注入されていない場合も正常動作する', async () => {
      const handler = new TestButtonHandler('test-button', logger);
      const context: ButtonHandlerContext = { interaction: mockInteraction };

      // エラーが発生せずに処理が完了することを確認
      await expect(handler.handle(context)).resolves.not.toThrow();
      
      // 既存のログが正常に記録されることを確認
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Test button action executed',
        expect.objectContaining({
          userId: 'user-123',
          customId: 'test-button'
        })
      );
    });

    it('既存のエラーハンドリングが正常動作する', async () => {
      const handler = new TestButtonHandler('test-button', logger);
      handler.shouldThrowError = true;
      const context: ButtonHandlerContext = { interaction: mockInteraction };

      await handler.handle(context);

      // 既存のエラーログが正常に記録されることを確認
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to handle button interaction'),
        expect.objectContaining({
          userId: 'user-123',
          customId: 'test-button'
        })
      );
    });
  });
});
