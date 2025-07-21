import { beforeEach, describe, expect, it } from 'vitest';
import { ButtonConfigManager } from '../../src/services/ButtonConfigManager';
import { ButtonStyle } from 'discord.js';

describe('ButtonConfigManager', () => {
  let manager: ButtonConfigManager;

  beforeEach(() => {
    // シングルトンインスタンスをリセット
    (ButtonConfigManager as any).instance = undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    manager = ButtonConfigManager.getInstance();
  });

  describe('シングルトンパターン', () => {
    it('同じインスタンスを返す', () => {
      const manager1 = ButtonConfigManager.getInstance();
      const manager2 = ButtonConfigManager.getInstance();
      
      expect(manager1).toBe(manager2);
    });
  });

  describe('コマンドボタン取得', () => {
    it('有効なコマンドのボタン設定を取得できる', () => {
      const buttons = manager.getCommandButtons('init-list');
      
      expect(buttons).toHaveLength(2);
      expect(buttons[0]).toEqual({
        customId: 'init-list-button',
        label: '同期',
        style: ButtonStyle.Primary,
        emoji: '🔄',
        description: 'リスト更新・再初期化',
        handler: 'InitListButtonHandler'
      });
      expect(buttons[1]).toEqual({
        customId: 'edit-list-button',
        label: '編集',
        style: ButtonStyle.Secondary,
        emoji: '📝',
        description: 'リスト編集',
        handler: null
      });
    });

    it('無効なコマンドの場合は空配列を返す', () => {
      const buttons = manager.getCommandButtons('ping');
      expect(buttons).toEqual([]);
    });

    it('存在しないコマンドの場合は空配列を返す', () => {
      const buttons = manager.getCommandButtons('nonexistent');
      expect(buttons).toEqual([]);
    });
  });

  describe('ボタン有効性チェック', () => {
    it('有効なコマンドでtrueを返す', () => {
      expect(manager.isButtonEnabled('init-list')).toBe(true);
    });

    it('無効なコマンドでfalseを返す', () => {
      expect(manager.isButtonEnabled('ping')).toBe(false);
    });

    it('存在しないコマンドでfalseを返す', () => {
      expect(manager.isButtonEnabled('nonexistent')).toBe(false);
    });
  });

  describe('デフォルト設定取得', () => {
    it('デフォルト設定を取得できる', () => {
      const defaultConfig = manager.getDefaultConfig();
      
      expect(defaultConfig).toEqual({
        enabled: false,
        max_buttons: 5
      });
    });
  });

  describe('設定全体取得', () => {
    it('設定全体を取得できる', () => {
      const settings = manager.getAllSettings();
      
      expect(settings).toHaveProperty('commands');
      expect(settings).toHaveProperty('default');
      expect(settings).toHaveProperty('styles');
      
      expect(settings.commands['init-list']).toEqual({
        enabled: true,
        buttons: [
          {
            customId: 'init-list-button',
            label: '同期',
            style: ButtonStyle.Primary,
            emoji: '🔄',
            description: 'リスト更新・再初期化',
            handler: 'InitListButtonHandler'
          },
          {
            customId: 'edit-list-button',
            label: '編集',
            style: ButtonStyle.Secondary,
            emoji: '📝',
            description: 'リスト編集',
            handler: null
          }
        ]
      });
    });
  });
});