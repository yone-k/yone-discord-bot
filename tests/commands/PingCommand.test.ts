import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest'
import { PingCommand } from '../../src/commands/PingCommand'
import { Logger, LogLevel } from '../../src/utils/logger'

describe('PingCommand', () => {
  let logger: Logger
  let loggerInfoSpy: MockedFunction<typeof logger.info>
  let loggerDebugSpy: MockedFunction<typeof logger.debug>
  let pingCommand: PingCommand

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG)
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    loggerDebugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    pingCommand = new PingCommand(logger)
  })

  describe('コンストラクタ', () => {
    it('名前が"ping"に設定される', () => {
      expect(pingCommand.getName()).toBe('ping')
    })

    it('説明が適切に設定される', () => {
      expect(pingCommand.getDescription()).toBe('Bot の疎通確認を行います（レスポンス時間測定付き）')
    })

    it('ロガーが正しく設定される', () => {
      expect(pingCommand.logger).toBe(logger)
    })
  })

  describe('execute メソッド', () => {
    it('実行時間測定を含む適切なログが出力される', async () => {
      await pingCommand.execute()

      expect(loggerDebugSpy).toHaveBeenCalledWith('Ping command started', {
        userId: undefined,
        guildId: undefined
      })
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^Pong! Response time: \d+(\.\d+)?ms$/),
        expect.objectContaining({
          responseTime: expect.any(String),
          userId: undefined
        })
      )
      expect(loggerDebugSpy).toHaveBeenCalledWith('Ping command completed')
    })

    it('レスポンス時間が測定されている', async () => {
      const startTime = Date.now()
      await pingCommand.execute()
      const endTime = Date.now()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^Pong! Response time: \d+(\.\d+)?ms$/),
        expect.objectContaining({
          responseTime: expect.any(String),
          userId: undefined
        })
      )

      // ログメッセージから実際の応答時間を抽出して検証
      const logCall = loggerInfoSpy.mock.calls.find((call: unknown[]) => 
        typeof call[0] === 'string' && call[0].includes('Pong! Response time:')
      )
      expect(logCall).toBeDefined()
      
      const responseTimeMatch = logCall[0].match(/Response time: (\d+(?:\.\d+)?)ms/)
      expect(responseTimeMatch).toBeTruthy()
      
      const responseTime = parseFloat(responseTimeMatch[1])
      expect(responseTime).toBeGreaterThanOrEqual(0)
      expect(responseTime).toBeLessThan(endTime - startTime + 10) // 10ms のマージン
    })

    it('複数回実行しても正常に動作する', async () => {
      await pingCommand.execute()
      await pingCommand.execute()

      expect(loggerDebugSpy).toHaveBeenCalledTimes(4) // start/completed x 2回
      expect(loggerInfoSpy).toHaveBeenCalledTimes(2) // Pong! x 2回
    })
  })

  describe('BaseCommand 継承', () => {
    it('BaseCommand のメソッドが利用可能', () => {
      expect(typeof pingCommand.getName).toBe('function')
      expect(typeof pingCommand.getDescription).toBe('function')
      expect(typeof pingCommand.execute).toBe('function')
    })
  })
})