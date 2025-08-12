import { describe, test, expect } from 'vitest';
import { CommandError, CommandErrorType } from '../../src/utils/CommandError';
import { GoogleSheetsError, GoogleSheetsErrorType } from '../../src/services/GoogleSheetsService';
import { ChannelSheetError, ChannelSheetErrorType } from '../../src/services/ChannelSheetManager';

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

    describe('GoogleSheetsError エラーメッセージ', () => {
      test('CONFIG_MISSING エラーメッセージが技術仕様準拠', () => {
        const error = new GoogleSheetsError(
          GoogleSheetsErrorType.CONFIG_MISSING,
          'Google Sheets configuration is missing'
        );

        expect(error.userMessage).toBe('Google Sheetsの設定が見つかりません。環境変数を確認してください。');
        expect(error.type).toBe(GoogleSheetsErrorType.CONFIG_MISSING);
      });

      test('AUTHENTICATION_FAILED エラーメッセージが技術仕様準拠', () => {
        const error = new GoogleSheetsError(
          GoogleSheetsErrorType.AUTHENTICATION_FAILED,
          'Authentication failed'
        );

        expect(error.userMessage).toBe('Google Sheetsの認証に失敗しました。');
        expect(error.type).toBe(GoogleSheetsErrorType.AUTHENTICATION_FAILED);
      });

      test('SPREADSHEET_NOT_FOUND エラーメッセージが技術仕様準拠', () => {
        const error = new GoogleSheetsError(
          GoogleSheetsErrorType.SPREADSHEET_NOT_FOUND,
          'Spreadsheet not found'
        );

        expect(error.userMessage).toBe('スプレッドシートが見つかりません。');
        expect(error.type).toBe(GoogleSheetsErrorType.SPREADSHEET_NOT_FOUND);
      });


      test('DATA_VALIDATION_ERROR エラーメッセージが技術仕様準拠', () => {
        const error = new GoogleSheetsError(
          GoogleSheetsErrorType.DATA_VALIDATION_ERROR,
          'Data validation error'
        );

        expect(error.userMessage).toBe('データの形式が正しくありません。');
        expect(error.type).toBe(GoogleSheetsErrorType.DATA_VALIDATION_ERROR);
      });
    });

    describe('ChannelSheetError エラーメッセージ', () => {
      test('CREATION_FAILED エラーメッセージが技術仕様準拠', () => {
        const error = new ChannelSheetError(
          ChannelSheetErrorType.CREATION_FAILED,
          'Sheet creation failed'
        );

        expect(error.userMessage).toBe('シートの作成に失敗しました。');
        expect(error.type).toBe(ChannelSheetErrorType.CREATION_FAILED);
      });

      test('OPERATION_FAILED エラーメッセージが技術仕様準拠', () => {
        const error = new ChannelSheetError(
          ChannelSheetErrorType.OPERATION_FAILED,
          'Operation failed'
        );

        expect(error.userMessage).toBe('シート操作に失敗しました。');
        expect(error.type).toBe(ChannelSheetErrorType.OPERATION_FAILED);
      });
    });
  });

  describe('エラーメッセージの一貫性確認', () => {
    test('全エラータイプでuserMessageが日本語', () => {
      const commandErrorTypes = Object.values(CommandErrorType);
      const googleErrorTypes = Object.values(GoogleSheetsErrorType);
      const channelErrorTypes = Object.values(ChannelSheetErrorType);

      // CommandError の確認
      commandErrorTypes.forEach(type => {
        const error = new CommandError(type, 'test-command', 'Test error');
        expect(error.userMessage).toMatch(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/); // 日本語文字を含む
        expect(error.userMessage.length).toBeGreaterThan(0);
      });

      // GoogleSheetsError の確認
      googleErrorTypes.forEach(type => {
        const error = new GoogleSheetsError(type, 'Test error');
        expect(error.userMessage).toMatch(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/); // 日本語文字を含む
        expect(error.userMessage.length).toBeGreaterThan(0);
      });

      // ChannelSheetError の確認
      channelErrorTypes.forEach(type => {
        const error = new ChannelSheetError(type, 'Test error');
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