import { describe, test, expect } from 'vitest';
import { CommandError, CommandErrorType } from '../../src/utils/CommandError';

describe('Error Message Specification Compliance Tests', () => {
  describe('技術仕様書5章準拠エラーメッセージ確認', () => {
    describe('CommandError エラーメッセージ', () => {
      test('PERMISSION_DENIED エラーメッセージが技術仕様準拠', () => {
        const error = new CommandError(
          CommandErrorType.PERMISSION_DENIED,
          'test-command',
          'Permission denied',
          'そのコマンドを実行する権限がありません。'
        );

        expect(error.userMessage).toBe('そのコマンドを実行する権限がありません。');
        expect(error.type).toBe(CommandErrorType.PERMISSION_DENIED);
        expect(error.commandName).toBe('test-command');
      });

      test('INVALID_PARAMETERS エラーメッセージが技術仕様準拠', () => {
        const error = new CommandError(
          CommandErrorType.INVALID_PARAMETERS,
          'test-command',
          'Invalid parameters',
          'コマンドのパラメータが正しくありません。'
        );

        expect(error.userMessage).toBe('コマンドのパラメータが正しくありません。');
        expect(error.type).toBe(CommandErrorType.INVALID_PARAMETERS);
      });

      test('EXECUTION_FAILED エラーメッセージが技術仕様準拠', () => {
        const error = new CommandError(
          CommandErrorType.EXECUTION_FAILED,
          'test-command',
          'Execution failed'
        );

        expect(error.userMessage).toBe('コマンドの実行中にエラーが発生しました。');
        expect(error.type).toBe(CommandErrorType.EXECUTION_FAILED);
      });


      test('SERVICE_UNAVAILABLE エラーメッセージが技術仕様準拠', () => {
        const error = new CommandError(
          CommandErrorType.SERVICE_UNAVAILABLE,
          'test-command',
          'Service unavailable'
        );

        expect(error.userMessage).toBe('サービスが利用できません。しばらく時間を置いてから再試行してください。');
        expect(error.type).toBe(CommandErrorType.SERVICE_UNAVAILABLE);
      });
    });

  });

  describe('エラーメッセージの一貫性確認', () => {
    test('全エラータイプでuserMessageが日本語', () => {
      const commandErrorTypes = Object.values(CommandErrorType);

      // CommandError の確認
      commandErrorTypes.forEach(type => {
        const error = new CommandError(type, 'test-command', 'Test error');
        expect(error.userMessage).toMatch(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/); // 日本語文字を含む
        expect(error.userMessage.length).toBeGreaterThan(0);
      });

    });

    test('エラーメッセージの長さが適切', () => {
      const error = new CommandError(
        CommandErrorType.PERMISSION_DENIED,
        'test-command',
        'Permission denied'
      );

      // ユーザーメッセージは5文字以上100文字以下
      expect(error.userMessage.length).toBeGreaterThanOrEqual(5);
      expect(error.userMessage.length).toBeLessThanOrEqual(100);
    });

    test('カスタムユーザーメッセージが正しく設定される', () => {
      const customMessage = 'カスタムエラーメッセージです。';
      const error = new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'test-command',
        'Test error',
        customMessage
      );

      expect(error.userMessage).toBe(customMessage);
    });

    test('エラー詳細情報が正しく生成される', () => {
      const error = new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'test-command',
        'Invalid parameters',
        'パラメータエラーです。'
      );

      const details = error.getErrorDetails();

      expect(details).toHaveProperty('type', CommandErrorType.INVALID_PARAMETERS);
      expect(details).toHaveProperty('commandName', 'test-command');
      expect(details).toHaveProperty('message', 'Invalid parameters');
      expect(details).toHaveProperty('userMessage', 'パラメータエラーです。');
      expect(details).toHaveProperty('timestamp');
      expect(typeof details.timestamp).toBe('string');
    });
  });

  describe('エラーメッセージの技術仕様準拠性確認', () => {
    test('権限エラーメッセージが明確で理解しやすい', () => {
      const permissionError = new CommandError(
        CommandErrorType.PERMISSION_DENIED,
        'init-list',
        'Permission denied'
      );

      const message = permissionError.userMessage;
      
      // 権限に関する説明が含まれている
      expect(message).toContain('権限');
      // ユーザーが理解しやすい日本語
      expect(message).not.toContain('Permission');
      expect(message).not.toContain('Error');
      // 適切な長さ
      expect(message.length).toBeLessThan(50);
    });

  });
});