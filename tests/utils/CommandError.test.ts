import { describe, it, expect } from 'vitest'
import { CommandError, CommandErrorType } from '../../src/utils/CommandError'

describe('CommandError', () => {
  describe('constructor', () => {
    it('should create a CommandError with all parameters', () => {
      const originalError = new Error('Original error')
      const error = new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'testCommand',
        'Test error message',
        'User friendly message',
        originalError
      )

      expect(error.name).toBe('CommandError')
      expect(error.type).toBe(CommandErrorType.EXECUTION_FAILED)
      expect(error.commandName).toBe('testCommand')
      expect(error.message).toBe('Test error message')
      expect(error.userMessage).toBe('User friendly message')
      expect(error.originalError).toBe(originalError)
    })

    it('should use default user message when not provided', () => {
      const error = new CommandError(
        CommandErrorType.NOT_FOUND,
        'testCommand',
        'Test error message'
      )

      expect(error.userMessage).toBe('そのコマンドは見つかりませんでした。')
    })
  })

  describe('getDefaultUserMessage', () => {
    it('should return correct message for NOT_FOUND', () => {
      const error = new CommandError(
        CommandErrorType.NOT_FOUND,
        'test',
        'message'
      )
      expect(error.userMessage).toBe('そのコマンドは見つかりませんでした。')
    })

    it('should return correct message for EXECUTION_FAILED', () => {
      const error = new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'test',
        'message'
      )
      expect(error.userMessage).toBe('コマンドの実行中にエラーが発生しました。')
    })

    it('should return correct message for PERMISSION_DENIED', () => {
      const error = new CommandError(
        CommandErrorType.PERMISSION_DENIED,
        'test',
        'message'
      )
      expect(error.userMessage).toBe('そのコマンドを実行する権限がありません。')
    })

    it('should return correct message for INVALID_PARAMETERS', () => {
      const error = new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'test',
        'message'
      )
      expect(error.userMessage).toBe('コマンドのパラメータが正しくありません。')
    })

    it('should return correct message for TIMEOUT', () => {
      const error = new CommandError(
        CommandErrorType.TIMEOUT,
        'test',
        'message'
      )
      expect(error.userMessage).toBe('コマンドの実行がタイムアウトしました。')
    })

    it('should return correct message for RATE_LIMITED', () => {
      const error = new CommandError(
        CommandErrorType.RATE_LIMITED,
        'test',
        'message'
      )
      expect(error.userMessage).toBe('レート制限により、しばらく時間を置いてから再試行してください。')
    })
  })

  describe('getErrorDetails', () => {
    it('should return error details object', () => {
      const originalError = new Error('Original error')
      const error = new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'testCommand',
        'Test error message',
        'User friendly message',
        originalError
      )

      const details = error.getErrorDetails()

      expect(details).toMatchObject({
        type: CommandErrorType.EXECUTION_FAILED,
        commandName: 'testCommand',
        message: 'Test error message',
        userMessage: 'User friendly message',
        originalError: 'Original error'
      })
      expect(details.timestamp).toBeDefined()
      expect(typeof details.timestamp).toBe('string')
    })

    it('should handle missing original error', () => {
      const error = new CommandError(
        CommandErrorType.NOT_FOUND,
        'testCommand',
        'Test error message'
      )

      const details = error.getErrorDetails()

      expect(details.originalError).toBeUndefined()
    })
  })
})