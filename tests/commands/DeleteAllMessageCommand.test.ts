import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeleteAllMessageCommand } from '../../src/commands/DeleteAllMessageCommand';
import { CommandError, CommandErrorType } from '../../src/utils/CommandError';
import { Logger } from '../../src/utils/logger';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';

// Mock classes
class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('DeleteAllMessageCommand', () => {
  let command: DeleteAllMessageCommand;
  let mockLogger: MockLogger;
  let mockContext: CommandExecutionContext;

  beforeEach(() => {
    mockLogger = new MockLogger();
    command = new DeleteAllMessageCommand(mockLogger as unknown as Logger);

    mockContext = {
      userId: 'test-user-id',
      guildId: 'test-guild-id',
      channelId: 'test-channel-id',
      interaction: {
        guild: {
          members: {
            fetch: vi.fn()
          }
        },
        showModal: vi.fn(),
        reply: vi.fn(),
        editReply: vi.fn(),
        client: {} as any
      } as any
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('コンストラクタ', () => {
    test('名前が"delete-all-message"に設定される', () => {
      expect(command.getName()).toBe('delete-all-message');
    });

    test('説明が適切に設定される', () => {
      expect(command.getDescription()).toBe('チャンネル内のすべてのメッセージを削除します');
    });

    test('deleteOnSuccessがtrueに設定される', () => {
      expect((command as any).deleteOnSuccess).toBe(true);
    });

    test('useThreadがfalseに設定される', () => {
      expect((command as any).useThread).toBe(false);
    });

    test('ephemeralがfalseに設定される', () => {
      expect(command.getEphemeral()).toBe(false);
    });
  });

  describe('権限チェック', () => {
    test('メッセージ削除権限がない場合にPERMISSION_DENIEDエラー', async () => {
      // 権限なしのユーザーをモック
      const mockMember = {
        permissions: new PermissionsBitField([])  // 権限なし
      };
      
      mockContext.interaction!.guild!.members.fetch = vi.fn().mockResolvedValue(mockMember);

      await expect(command.execute(mockContext)).rejects.toThrow(CommandError);

      try {
        await command.execute(mockContext);
      } catch (error) {
        const cmdError = error as CommandError;
        expect(cmdError.type).toBe(CommandErrorType.PERMISSION_DENIED);
        expect(cmdError.userMessage).toBe('メッセージを削除する権限がありません。');
        expect(cmdError.commandName).toBe('delete-all-message');
      }

      expect(mockContext.interaction!.guild!.members.fetch).toHaveBeenCalledWith('test-user-id');
      // BaseCommandのsafeExecuteを通した場合のみloggerが呼ばれるため、この確認は削除
    });

    test('メッセージ削除権限がある場合は確認モーダルを表示', async () => {
      // 権限ありのユーザーをモック
      const mockMember = {
        permissions: new PermissionsBitField([PermissionFlagsBits.ManageMessages])
      };
      
      mockContext.interaction!.guild!.members.fetch = vi.fn().mockResolvedValue(mockMember);

      await command.execute(mockContext);

      expect(mockContext.interaction!.guild!.members.fetch).toHaveBeenCalledWith('test-user-id');
      expect(mockContext.interaction!.showModal).toHaveBeenCalled();
      
      // モーダルの内容確認
      const modalCall = (mockContext.interaction!.showModal as any).mock.calls[0][0];
      expect(modalCall.data.custom_id).toBe('confirmation-modal');
      expect(modalCall.data.title).toBe('メッセージ全削除の確認');
    });

    test('ギルドが存在しない場合にエラー', async () => {
      const contextWithoutGuild = {
        ...mockContext,
        interaction: {
          ...mockContext.interaction,
          guild: null
        }
      };

      await expect(command.execute(contextWithoutGuild)).rejects.toThrow(CommandError);

      try {
        await command.execute(contextWithoutGuild);
      } catch (error) {
        const cmdError = error as CommandError;
        expect(cmdError.type).toBe(CommandErrorType.INVALID_PARAMETERS);
        expect(cmdError.userMessage).toBe('このコマンドはサーバー内でのみ使用できます。');
        expect(cmdError.commandName).toBe('delete-all-message');
      }
    });
  });

  describe('静的メソッド', () => {
    test('getCommandName()が正しい値を返す', () => {
      expect(DeleteAllMessageCommand.getCommandName()).toBe('delete-all-message');
    });

    test('getCommandDescription()が正しい値を返す', () => {
      expect(DeleteAllMessageCommand.getCommandDescription()).toBe('チャンネル内のすべてのメッセージを削除します');
    });
  });

  describe('エラーハンドリング', () => {
    test('メンバー取得に失敗した場合にエラー', async () => {
      mockContext.interaction!.guild!.members.fetch = vi.fn().mockRejectedValue(new Error('Member fetch failed'));

      await expect(command.execute(mockContext)).rejects.toThrow(CommandError);

      try {
        await command.execute(mockContext);
      } catch (error) {
        const cmdError = error as CommandError;
        expect(cmdError.type).toBe(CommandErrorType.EXECUTION_FAILED);
        expect(cmdError.message).toContain('Member fetch failed');
      }

      // BaseCommandのsafeExecuteを通した場合のみloggerが呼ばれるため、この確認は削除
    });
  });
});