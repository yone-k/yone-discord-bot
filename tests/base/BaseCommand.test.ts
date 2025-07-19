import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest'
import { BaseCommand, CommandExecutionContext } from '../../src/base/BaseCommand'
import { Logger, LogLevel } from '../../src/utils/logger'
import { CommandError, CommandErrorType } from '../../src/utils/CommandError'

class TestCommand extends BaseCommand {
  public shouldThrowError = false
  public customError: Error | null = null

  constructor(logger: Logger) {
    super('test', 'Test command description', logger)
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (this.shouldThrowError) {
      if (this.customError) {
        throw this.customError
      }
      throw new Error('Test error')
    }
    this.logger.info('Test command executed', { userId: context?.userId })
  }
}

describe('BaseCommand', () => {
  let logger: Logger
  let loggerInfoSpy: MockedFunction<typeof logger.info>
  let loggerErrorSpy: MockedFunction<typeof logger.error>

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG)
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
  })

  describe('コンストラクタ', () => {
    it('名前、説明、ロガーを正しく設定する', () => {
      const command = new TestCommand(logger)
      
      expect(command.getName()).toBe('test')
      expect(command.getDescription()).toBe('Test command description')
    })
  })

  describe('execute メソッド', () => {
    it('実装されたコマンドが実行できる', async () => {
      const command = new TestCommand(logger)
      const context = { userId: 'test-user' }
      
      await command.execute(context)
      
      expect(loggerInfoSpy).toHaveBeenCalledWith('Test command executed', { userId: 'test-user' })
    })
  })

  describe('safeExecute メソッド', () => {
    it('正常実行時は成功結果を返す', async () => {
      const command = new TestCommand(logger)
      const context = { userId: 'test-user', guildId: 'test-guild' }
      
      const result = await command.safeExecute(context)
      
      expect(result.success).toBe(true)
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.error).toBeUndefined()
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Executing command "test"'),
        expect.objectContaining({ userId: 'test-user', guildId: 'test-guild' })
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Command "test" completed successfully'),
        expect.objectContaining({ userId: 'test-user' })
      )
    })

    it('エラー発生時は失敗結果を返す', async () => {
      const command = new TestCommand(logger)
      command.shouldThrowError = true
      
      const result = await command.safeExecute()
      
      expect(result.success).toBe(false)
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.error).toBeInstanceOf(CommandError)
      expect(result.error?.type).toBe(CommandErrorType.EXECUTION_FAILED)
      expect(result.error?.commandName).toBe('test')
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Command "test" failed'),
        expect.objectContaining({
          error: expect.any(Object),
          executionTime: expect.any(String)
        })
      )
    })

    it('CommandErrorが投げられた場合はそのまま使用する', async () => {
      const command = new TestCommand(logger)
      const customError = new CommandError(
        CommandErrorType.PERMISSION_DENIED,
        'test',
        'Permission denied',
        'カスタムエラーメッセージ'
      )
      command.shouldThrowError = true
      command.customError = customError
      
      const result = await command.safeExecute()
      
      expect(result.success).toBe(false)
      expect(result.error).toBe(customError)
      expect(result.error?.type).toBe(CommandErrorType.PERMISSION_DENIED)
      expect(result.error?.userMessage).toBe('カスタムエラーメッセージ')
    })

    it('非Errorオブジェクトが投げられた場合も適切に処理する', async () => {
      const command = new TestCommand(logger)
      command.shouldThrowError = true
      command.customError = 'string error' as any
      
      const result = await command.safeExecute()
      
      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(CommandError)
      expect(result.error?.message).toBe('Unknown error occurred during command execution')
    })
  })

  describe('getName メソッド', () => {
    it('コマンド名を返す', () => {
      const command = new TestCommand(logger)
      
      expect(command.getName()).toBe('test')
    })
  })

  describe('getDescription メソッド', () => {
    it('コマンドの説明を返す', () => {
      const command = new TestCommand(logger)
      
      expect(command.getDescription()).toBe('Test command description')
    })
  })
})