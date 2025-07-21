export interface ReactionConfig {
  emoji: string;
  description: string;
  handler: string | null;
}

export interface CommandReactionConfig {
  enabled: boolean;
  reactions: ReactionConfig[];
}

export interface ReactionSettings {
  commands: Record<string, CommandReactionConfig>;
  default: {
    enabled: boolean;
    max_reactions: number;
    auto_add_timeout: number;
  };
  emojis: Record<string, string>;
}

// リアクション設定
export const reactionSettings: ReactionSettings = {
  commands: {
    'init-list': {
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
    },
    
    // 他のコマンドの設定例（将来の拡張用）
    ping: {
      enabled: false,
      reactions: []
    }
  },
  
  // デフォルト設定
  default: {
    enabled: false,
    max_reactions: 5,
    auto_add_timeout: 1000  // ミリ秒
  },
  
  // リアクション絵文字の定義
  emojis: {
    refresh: '🔄',
    edit: '📝',
    clipboard: '📋',
    check: '✅',
    cross: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    plus: '➕',
    minus: '➖',
    gear: '⚙️'
  }
};