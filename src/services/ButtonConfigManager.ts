import { buttonSettings, ButtonConfig, CommandButtonConfig } from '../configs/buttons';

export type { ButtonConfig, CommandButtonConfig };

export class ButtonConfigManager {
  private static instance: ButtonConfigManager;

  private constructor() {
    // シングルトンパターン
  }

  public static getInstance(): ButtonConfigManager {
    if (!ButtonConfigManager.instance) {
      ButtonConfigManager.instance = new ButtonConfigManager();
    }
    return ButtonConfigManager.instance;
  }

  public getCommandButtons(commandName: string): ButtonConfig[] {
    const commandConfig = buttonSettings.commands[commandName];
    
    if (commandConfig && commandConfig.enabled) {
      return commandConfig.buttons || [];
    }
    
    return [];
  }

  public isButtonEnabled(commandName: string): boolean {
    const commandConfig = buttonSettings.commands[commandName];
    return commandConfig?.enabled || false;
  }

  public getDefaultConfig(): { enabled: boolean; max_buttons: number } {
    return buttonSettings.default;
  }

  // 設定の全体取得（デバッグ・テスト用）
  public getAllSettings(): typeof buttonSettings {
    return buttonSettings;
  }
}