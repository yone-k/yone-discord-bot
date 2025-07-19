import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest'
import { CommandManager } from '../../src/utils/CommandManager'
import { BaseCommand, CommandExecutionContext } from '../../src/base/BaseCommand'
import { Logger, LogLevel } from '../../src/utils/logger'
import { CommandError, CommandErrorType } from '../../src/utils/CommandError'

class TestCommand extends BaseCommand {
  public shouldThrowError = false
  public customError: Error | null = null

  constructor(name: string, description: string, logger: Logger) {
    super(name, description, logger)
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (this.shouldThrowError) {
      if (this.customError) {
        throw this.customError
      }
      throw new Error('Test error')
    }
    this.logger.info(`${this.name} command executed`, { userId: context?.userId })
  }
}

describe('CommandManager', () => {
  let commandManager: CommandManager
  let logger: Logger
  let loggerInfoSpy: MockedFunction<typeof logger.info>
  let loggerWarnSpy: MockedFunction<typeof logger.warn>

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG)
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    commandManager = new CommandManager(logger)
  })

  describe('コマンド登録', () => {
    it('コマンドを登録できる', () => {
      const testCommand = new TestCommand('test', 'Test command', logger)
      
      commandManager.register(testCommand)
      
      expect(commandManager.getCommand('test')).toBe(testCommand)
      expect(commandManager.getCommandStats('test')).toMatchObject({
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        averageExecutionTime: 0
      })
    })

    it('重複したコマンド名で登録するとエラーが発生する', () => {
      const testCommand1 = new TestCommand('test', 'Test command 1', logger)
      const testCommand2 = new TestCommand('test', 'Test command 2', logger)
      
      commandManager.register(testCommand1)
      
      expect(() => commandManager.register(testCommand2)).toThrow('Command "test" is already registered')
    })
  })

  describe('コマンド取得', () => {
    it('登録されたコマンドを取得できる', () => {
      const testCommand = new TestCommand('test', 'Test command', logger)
      commandManager.register(testCommand)
      
      const retrieved = commandManager.getCommand('test')
      
      expect(retrieved).toBe(testCommand)
    })

    it('存在しないコマンドを取得するとundefinedが返る', () => {
      const retrieved = commandManager.getCommand('nonexistent')
      
      expect(retrieved).toBeUndefined()
    })
  })

  describe('コマンド実行', () => {
    it('登録されたコマンドを実行できる', async () => {
      const testCommand = new TestCommand('test', 'Test command', logger)
      commandManager.register(testCommand)
      const context = { userId: 'test-user' }
      
      const result = await commandManager.execute('test', context)
      
      expect(result.success).toBe(true)
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.error).toBeUndefined()
      
      const stats = commandManager.getCommandStats('test')
      expect(stats?.totalExecutions).toBe(1)
      expect(stats?.successfulExecutions).toBe(1)
      expect(stats?.failedExecutions).toBe(0)
    })

    it('存在しないコマンドを実行するとCommandErrorが返る', async () => {
      const context = { userId: 'test-user' }
      
      const result = await commandManager.execute('nonexistent', context)
      
      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(CommandError)
      expect(result.error?.type).toBe(CommandErrorType.NOT_FOUND)
      expect(result.error?.commandName).toBe('nonexistent')
      expect(result.error?.userMessage).toBe('コマンド "nonexistent" が見つかりませんでした。')
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Attempted to execute unknown command: "nonexistent"',
        expect.objectContaining({ userId: 'test-user' })
      )
    })

    it('コマンド実行時にエラーが発生した場合は失敗結果を返す', async () => {
      const testCommand = new TestCommand('test', 'Test command', logger)
      testCommand.shouldThrowError = true
      commandManager.register(testCommand)
      
      const result = await commandManager.execute('test')
      
      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(CommandError)
      expect(result.error?.type).toBe(CommandErrorType.EXECUTION_FAILED)
      
      const stats = commandManager.getCommandStats('test')
      expect(stats?.totalExecutions).toBe(1)
      expect(stats?.successfulExecutions).toBe(0)
      expect(stats?.failedExecutions).toBe(1)
    })
  })

  describe('統計情報', () => {
    it('コマンド実行統計を正しく追跡する', async () => {
      const testCommand = new TestCommand('test', 'Test command', logger)
      commandManager.register(testCommand)
      
      // 成功実行
      await commandManager.execute('test')
      await commandManager.execute('test')
      
      // 失敗実行
      testCommand.shouldThrowError = true
      await commandManager.execute('test')
      
      const stats = commandManager.getCommandStats('test')
      expect(stats?.totalExecutions).toBe(3)
      expect(stats?.successfulExecutions).toBe(2)
      expect(stats?.failedExecutions).toBe(1)
      expect(stats?.averageExecutionTime).toBeGreaterThan(0)
      expect(stats?.lastExecutionTime).toBeInstanceOf(Date)
    })

    it('利用可能なコマンド名の一覧を取得できる', () => {
      const testCommand1 = new TestCommand('test1', 'Test command 1', logger)
      const testCommand2 = new TestCommand('test2', 'Test command 2', logger)
      
      commandManager.register(testCommand1)
      commandManager.register(testCommand2)
      
      const commandNames = commandManager.getAvailableCommandNames()
      
      expect(commandNames).toEqual(['test1', 'test2'])
    })

    it('実行統計サマリーをログ出力する', () => {
      const testCommand = new TestCommand('test', 'Test command', logger)
      commandManager.register(testCommand)
      
      commandManager.logExecutionSummary()
      
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Command execution summary',
        expect.objectContaining({
          totalCommands: 1,
          totalExecutions: 0,
          totalSuccess: 0,
          totalFailed: 0,
          successRate: '0%'
        })
      )
    })
  })

  describe('コマンド一覧', () => {
    it('登録されたコマンドの一覧を取得できる', () => {
      const testCommand1 = new TestCommand('test1', 'Test command 1', logger)
      const testCommand2 = new TestCommand('test2', 'Test command 2', logger)
      
      commandManager.register(testCommand1)
      commandManager.register(testCommand2)
      
      const commands = commandManager.getAllCommands()
      
      expect(commands).toHaveLength(2)
      expect(commands).toContain(testCommand1)
      expect(commands).toContain(testCommand2)
    })

    it('コマンドが登録されていない場合は空配列が返る', () => {
      const commands = commandManager.getAllCommands()
      
      expect(commands).toEqual([])
    })
  })
})