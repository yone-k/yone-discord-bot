import { beforeEach, describe, expect, it } from 'vitest';
import { ReactionConfigManager } from '../../src/services/ReactionConfigManager';

describe('ReactionConfigManager', () => {
  let manager: ReactionConfigManager;

  beforeEach(() => {
    // シングルトンインスタンスをリセット
    (ReactionConfigManager as any).instance = undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    manager = ReactionConfigManager.getInstance();
  });

  describe('シングルトンパターン', () => {
    it('同じインスタンスを返す', () => {
      const manager1 = ReactionConfigManager.getInstance();
      const manager2 = ReactionConfigManager.getInstance();
      
      expect(manager1).toBe(manager2);
    });
  });

  describe('コマンドリアクション取得', () => {
    it('有効なコマンドのリアクション設定を取得できる', () => {
      const reactions = manager.getCommandReactions('init-list');
      
      expect(reactions).toHaveLength(2);
      expect(reactions[0]).toEqual({
        emoji: '🔄',
        description: 'リスト更新・再初期化',
        handler: 'InitListReactionHandler'
      });
      expect(reactions[1]).toEqual({
        emoji: '📝',
        description: 'リスト編集',
        handler: null
      });
    });

    it('無効なコマンドの場合は空配列を返す', () => {
      const reactions = manager.getCommandReactions('ping');
      expect(reactions).toEqual([]);
    });

    it('存在しないコマンドの場合は空配列を返す', () => {
      const reactions = manager.getCommandReactions('nonexistent');
      expect(reactions).toEqual([]);
    });
  });

  describe('リアクション有効性チェック', () => {
    it('有効なコマンドでtrueを返す', () => {
      expect(manager.isReactionEnabled('init-list')).toBe(true);
    });

    it('無効なコマンドでfalseを返す', () => {
      expect(manager.isReactionEnabled('ping')).toBe(false);
    });

    it('存在しないコマンドでfalseを返す', () => {
      expect(manager.isReactionEnabled('nonexistent')).toBe(false);
    });
  });

  describe('絵文字取得', () => {
    it('定義済みの絵文字を取得できる', () => {
      expect(manager.getEmoji('refresh')).toBe('🔄');
      expect(manager.getEmoji('edit')).toBe('📝');
      expect(manager.getEmoji('clipboard')).toBe('📋');
      expect(manager.getEmoji('check')).toBe('✅');
    });

    it('存在しない絵文字名の場合はundefinedを返す', () => {
      expect(manager.getEmoji('nonexistent')).toBeUndefined();
    });
  });

  describe('デフォルト設定取得', () => {
    it('デフォルト設定を取得できる', () => {
      const defaultConfig = manager.getDefaultConfig();
      
      expect(defaultConfig).toEqual({
        enabled: false,
        max_reactions: 5,
        auto_add_timeout: 1000
      });
    });
  });

  describe('設定全体取得', () => {
    it('設定全体を取得できる', () => {
      const settings = manager.getAllSettings();
      
      expect(settings).toHaveProperty('commands');
      expect(settings).toHaveProperty('default');
      expect(settings).toHaveProperty('emojis');
      
      expect(settings.commands['init-list']).toEqual({
        enabled: true,
        reactions: [
          {
            emoji: '🔄',
            description: 'リスト更新・再初期化',
            handler: 'InitListReactionHandler'
          },
          {
            emoji: '📝',
            description: 'リスト編集',
            handler: null
          }
        ]
      });
    });
  });
});