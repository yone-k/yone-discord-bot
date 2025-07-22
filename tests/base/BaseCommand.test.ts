import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import { BaseCommand, CommandExecutionContext } from '../../src/base/BaseCommand';
import { Logger, LogLevel } from '../../src/utils/logger';
import { CommandError, CommandErrorType } from '../../src/utils/CommandError';

class TestCommand extends BaseCommand {
  public shouldThrowError = false;
  public customError: Error | null = null;

  constructor(logger: Logger, deleteOnSuccess = false, useThread = false, ephemeral = false) {
    super('test', 'Test command description', logger);
    this.deleteOnSuccess = deleteOnSuccess;
    this.useThread = useThread;
    this.ephemeral = ephemeral;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (this.shouldThrowError) {
      if (this.customError) {
        throw this.customError;
      }
      throw new Error('Test error');
    }
    this.logger.info('Test command executed', { userId: context?.userId });
  }
}

describe('BaseCommand', () => {
  let logger: Logger;
  let loggerInfoSpy: MockedFunction<typeof logger.info>;
  let loggerErrorSpy: MockedFunction<typeof logger.error>;

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG);
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  describe('コンストラクタ', () => {
    it('名前、説明、ロガーを正しく設定する', () => {
      const command = new TestCommand(logger);
      
      expect(command.getName()).toBe('test');
      expect(command.getDescription()).toBe('Test command description');
    });

    it('ephemeralオプションを正しく設定する', () => {
      const commandDefault = new TestCommand(logger);
      expect(commandDefault.getEphemeral()).toBe(false);

      const commandEphemeralTrue = new TestCommand(logger, false, false, true);
      expect(commandEphemeralTrue.getEphemeral()).toBe(true);
    });
  });

  describe('execute メソッド', () => {
    it('実装されたコマンドが実行できる', async () => {
      const command = new TestCommand(logger);
      const context = { userId: 'test-user' };
      
      await command.execute(context);
      
      expect(loggerInfoSpy).toHaveBeenCalledWith('Test command executed', { userId: 'test-user' });
    });
  });

  describe('safeExecute メソッド', () => {
    it('正常実行時は成功結果を返す', async () => {
      const command = new TestCommand(logger);
      const context = { userId: 'test-user', guildId: 'test-guild' };
      
      const result = await command.safeExecute(context);
      
      expect(result.success).toBe(true);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Executing command "test"'),
        expect.objectContaining({ userId: 'test-user', guildId: 'test-guild' })
      );
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Command "test" completed successfully'),
        expect.objectContaining({ userId: 'test-user' })
      );
    });

    it('エラー発生時は失敗結果を返す', async () => {
      const command = new TestCommand(logger);
      command.shouldThrowError = true;
      
      const result = await command.safeExecute();
      
      expect(result.success).toBe(false);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeInstanceOf(CommandError);
      expect(result.error?.type).toBe(CommandErrorType.EXECUTION_FAILED);
      expect(result.error?.commandName).toBe('test');
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Command "test" failed'),
        expect.objectContaining({
          error: expect.any(Object),
          executionTime: expect.any(String)
        })
      );
    });

    it('CommandErrorが投げられた場合はそのまま使用する', async () => {
      const command = new TestCommand(logger);
      const customError = new CommandError(
        CommandErrorType.PERMISSION_DENIED,
        'test',
        'Permission denied',
        'カスタムエラーメッセージ'
      );
      command.shouldThrowError = true;
      command.customError = customError;
      
      const result = await command.safeExecute();
      
      expect(result.success).toBe(false);
      expect(result.error).toBe(customError);
      expect(result.error?.type).toBe(CommandErrorType.PERMISSION_DENIED);
      expect(result.error?.userMessage).toBe('カスタムエラーメッセージ');
    });

    it('非Errorオブジェクトが投げられた場合も適切に処理する', async () => {
      const command = new TestCommand(logger);
      command.shouldThrowError = true;
      command.customError = 'string error' as any;
      
      const result = await command.safeExecute();
      
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(CommandError);
      expect(result.error?.message).toBe('Unknown error occurred during command execution');
    });
  });

  describe('getName メソッド', () => {
    it('コマンド名を返す', () => {
      const command = new TestCommand(logger);
      
      expect(command.getName()).toBe('test');
    });
  });

  describe('getDescription メソッド', () => {
    it('コマンドの説明を返す', () => {
      const command = new TestCommand(logger);
      
      expect(command.getDescription()).toBe('Test command description');
    });
  });

  describe('deleteOnSuccess 機能', () => {
    it('deleteOnSuccessがfalseの場合は削除処理を実行しない', async () => {
      const command = new TestCommand(logger, false, false);
      const mockInteraction = {
        fetchReply: vi.fn(),
        replied: false
      };
      const mockThread = {
        delete: vi.fn()
      };
      const context = {
        interaction: mockInteraction as any,
        thread: mockThread as any,
        userId: 'test-user'
      };

      const result = await command.safeExecute(context);

      expect(result.success).toBe(true);
      expect(mockThread.delete).not.toHaveBeenCalled();
      expect(mockInteraction.fetchReply).not.toHaveBeenCalled();
    });

    it('deleteOnSuccessがtrueでuseThreadがtrueの場合は削除処理を実行する', async () => {
      const command = new TestCommand(logger, true, true);
      const mockMessage = { delete: vi.fn() };
      const mockInteraction = {
        fetchReply: vi.fn().mockResolvedValue(mockMessage),
        replied: false,
        deferReply: vi.fn().mockResolvedValue(undefined)
      };
      const mockThread = {
        delete: vi.fn()
      };
      const mockStartThread = vi.fn().mockResolvedValue(mockThread);
      mockMessage.startThread = mockStartThread;

      const context = {
        interaction: mockInteraction as any,
        userId: 'test-user'
      };

      const result = await command.safeExecute(context);

      expect(result.success).toBe(true);
      expect(mockThread.delete).toHaveBeenCalled();
      expect(mockInteraction.fetchReply).toHaveBeenCalledTimes(2); // createThread と削除処理で2回
      expect(mockMessage.delete).toHaveBeenCalled();
    });

    it('削除処理でエラーが発生してもコマンドは成功として扱う', async () => {
      const command = new TestCommand(logger, true, true);
      const mockMessage = { 
        delete: vi.fn(),
        startThread: vi.fn().mockResolvedValue({ delete: vi.fn() })
      };
      const mockInteraction = {
        fetchReply: vi.fn().mockResolvedValue(mockMessage),
        replied: false,
        deferReply: vi.fn().mockResolvedValue(undefined)
      };

      // 削除処理でエラーを発生させる
      mockMessage.delete.mockRejectedValue(new Error('Delete failed'));

      const context = {
        interaction: mockInteraction as any,
        userId: 'test-user'
      };

      const loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = await command.safeExecute(context);

      expect(result.success).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Failed to delete thread or message for command "test"',
        expect.objectContaining({ error: 'Delete failed' })
      );
    });
  });
});