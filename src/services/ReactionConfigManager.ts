import { reactionSettings, ReactionConfig, CommandReactionConfig } from '../configs/reactions';

export type { ReactionConfig, CommandReactionConfig };

export class ReactionConfigManager {
  private static instance: ReactionConfigManager;

  private constructor() {
    // シングルトンパターン
  }

  public static getInstance(): ReactionConfigManager {
    if (!ReactionConfigManager.instance) {
      ReactionConfigManager.instance = new ReactionConfigManager();
    }
    return ReactionConfigManager.instance;
  }

  public getCommandReactions(commandName: string): ReactionConfig[] {
    const commandConfig = reactionSettings.commands[commandName];
    
    if (commandConfig && commandConfig.enabled) {
      return commandConfig.reactions || [];
    }
    
    return [];
  }

  public isReactionEnabled(commandName: string): boolean {
    const commandConfig = reactionSettings.commands[commandName];
    return commandConfig?.enabled || false;
  }

  public getEmoji(name: string): string | undefined {
    return reactionSettings.emojis[name];
  }

  public getDefaultConfig(): { enabled: boolean; max_reactions: number; auto_add_timeout: number } {
    return reactionSettings.default;
  }

  // 設定の全体取得（デバッグ・テスト用）
  public getAllSettings(): typeof reactionSettings {
    return reactionSettings;
  }
}