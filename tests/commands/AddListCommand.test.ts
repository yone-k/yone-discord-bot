import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../../src/utils/logger';
import { AddListCommand } from '../../src/commands/AddListCommand';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';

// Mock classes
class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('AddListCommand', () => {
  let command: AddListCommand;
  let mockLogger: MockLogger;
  let mockContext: CommandExecutionContext;

  beforeEach(() => {
    mockLogger = new MockLogger();
    command = new AddListCommand(mockLogger as unknown as Logger);

    mockContext = {
      userId: 'test-user-id',
      guildId: 'test-guild-id',
      channelId: 'test-channel-id',
      interaction: {
        showModal: vi.fn(),
        reply: vi.fn(),
        editReply: vi.fn(),
      } as any
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('コンストラクタ', () => {
    it('名前が"add-list"に設定される', () => {
      expect(command.getName()).toBe('add-list');
    });

    it('説明が適切に設定される', () => {
      expect(command.getDescription()).toBe('リストに新しい項目を追加します');
    });

    it('ロガーが正しく設定される', () => {
      expect((command as any).logger).toBe(mockLogger);
    });

    it('useThreadがfalseに設定される', () => {
      expect((command as any).useThread).toBe(false);
    });

    it('ephemeralがtrueに設定される', () => {
      expect(command.getEphemeral()).toBe(true);
    });
  });

  describe('execute メソッド', () => {
    it('interactionが存在しない場合はエラーをスローする', async () => {
      const contextWithoutInteraction = {
        userId: 'test-user-id',
        guildId: 'test-guild-id',
        channelId: 'test-channel-id'
      };

      await expect(command.execute(contextWithoutInteraction)).rejects.toThrow(
        'このコマンドはDiscordインタラクションが必要です'
      );
    });

    it('channelIdが存在しない場合はエラーをスローする', async () => {
      const contextWithoutChannelId = {
        ...mockContext,
        channelId: undefined
      };

      await expect(command.execute(contextWithoutChannelId)).rejects.toThrow(
        'チャンネルIDが取得できません'
      );
    });

    it('正常な場合はモーダルを表示する', async () => {
      await command.execute(mockContext);

      expect(mockContext.interaction!.showModal).toHaveBeenCalledTimes(1);
      expect(mockContext.interaction!.showModal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            custom_id: 'add-list-modal',
            title: 'リストに項目を追加'
          })
        })
      );
    });

    it('モーダルのコンポーネントが正しく設定される', async () => {
      await command.execute(mockContext);

      const modalCall = (mockContext.interaction!.showModal as any).mock.calls[0][0];
      const components = modalCall.components;

      // カテゴリーフィールド
      const categoryComponent = components[0].components[0];
      expect(categoryComponent.data.custom_id).toBe('category');
      expect(categoryComponent.data.label).toBe('カテゴリー（省略可）');
      expect(categoryComponent.data.style).toBe(1); // Short
      expect(categoryComponent.data.required).toBe(false);
      expect(categoryComponent.data.max_length).toBe(50);

      // アイテムフィールド
      const itemsComponent = components[1].components[0];
      expect(itemsComponent.data.custom_id).toBe('items');
      expect(itemsComponent.data.label).toBe('名前,期限（1行に1つずつ記入）');
      expect(itemsComponent.data.style).toBe(2); // Paragraph
      expect(itemsComponent.data.required).toBe(true);
      expect(itemsComponent.data.max_length).toBe(4000);
    });

    it('実行時にロガーに適切なログが出力される', async () => {
      await command.execute(mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Showing add-list modal', 
        {
          channelId: 'test-channel-id',
          userId: 'test-user-id'
        }
      );
    });
  });

  describe('BaseCommand 継承', () => {
    it('BaseCommand のメソッドが利用可能', () => {
      expect(typeof command.getName).toBe('function');
      expect(typeof command.getDescription).toBe('function');
      expect(typeof command.execute).toBe('function');
      expect(typeof command.getEphemeral).toBe('function');
    });
  });
});