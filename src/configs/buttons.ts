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
    'list': {
      enabled: true,
      buttons: [
        {
          customId: 'add-list-button',
          label: '追加',
          style: ButtonStyle.Success,
          emoji: '➕',
          description: 'リストに項目を追加',
          handler: 'AddListButtonHandler'
        },
        {
          customId: 'edit-list-button',
          label: '編集',
          style: ButtonStyle.Primary,
          emoji: '📝',
          description: 'リスト編集',
          handler: 'EditListButtonHandler'
        },
        {
          customId: 'init-list-button',
          label: '同期',
          style: ButtonStyle.Primary,
          emoji: '🔄',
          description: 'リスト更新・再初期化',
          handler: 'InitListButtonHandler'
        }
      ]
    },
    
    // 他のコマンドの設定例（将来の拡張用）
    ping: {
      enabled: false,
      buttons: []
    },

    inventory: {
      enabled: true,
      buttons: [
        {
          customId: 'inventory_add',
          label: '追加',
          style: ButtonStyle.Primary,
          description: '在庫アイテムを追加',
          handler: 'InventoryAddButtonHandler'
        },
        {
          customId: 'inventory_update',
          label: '更新',
          style: ButtonStyle.Secondary,
          description: '在庫アイテムを更新',
          handler: 'InventoryUpdateButtonHandler'
        },
        {
          customId: 'inventory_delete',
          label: '削除',
          style: ButtonStyle.Danger,
          description: '在庫アイテムを削除',
          handler: 'InventoryDeleteButtonHandler'
        }
      ]
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
