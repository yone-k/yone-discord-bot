import { ButtonStyle } from 'discord.js';

export interface ButtonConfig {
  customId: string;
  label: string;
  style: ButtonStyle;
  emoji?: string;
  description: string;
  handler: string | null;
}

export interface CommandButtonConfig {
  enabled: boolean;
  buttons: ButtonConfig[];
}

export interface ButtonSettings {
  commands: Record<string, CommandButtonConfig>;
  default: {
    enabled: boolean;
    max_buttons: number;
  };
  styles: Record<string, ButtonStyle>;
}

// ボタン設定
export const buttonSettings: ButtonSettings = {
  commands: {
    'init-list': {
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
    },
    
    // 他のコマンドの設定例（将来の拡張用）
    ping: {
      enabled: false,
      buttons: []
    }
  },
  
  // デフォルト設定
  default: {
    enabled: false,
    max_buttons: 5
  },
  
  // ボタンスタイルの定義
  styles: {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
    link: ButtonStyle.Link
  }
};