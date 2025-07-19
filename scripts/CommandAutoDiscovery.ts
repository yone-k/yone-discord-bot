import { promises as fs } from 'fs';
import path from 'path';
import { BaseCommand } from '../src/base/BaseCommand';
import { Logger } from '../src/utils/logger';

export class CommandAutoDiscovery {
  private logger: Logger;
  private commandsDir: string;

  constructor(logger: Logger, commandsDir: string = 'src/commands') {
    this.logger = logger;
    this.commandsDir = commandsDir;
  }

  async discoverCommands(): Promise<BaseCommand[]> {
    try {
      this.logger.debug(`Discovering commands in ${this.commandsDir}`);
      
      const commandFiles = await this.getCommandFiles();
      const commands: BaseCommand[] = [];

      for (const file of commandFiles) {
        try {
          const command = await this.loadCommandFromFile(file);
          if (command) {
            commands.push(command);
            this.logger.debug(`Loaded command: ${command.getName()}`);
          }
        } catch (error) {
          this.logger.warn(`Failed to load command from ${file}: ${error}`);
        }
      }

      this.logger.info(`Discovered ${commands.length} commands`);
      return commands;
    } catch (error) {
      this.logger.error(`Failed to discover commands: ${error}`);
      return [];
    }
  }

  private async getCommandFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.commandsDir);
      return files
        .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .map(file => path.join(this.commandsDir, file));
    } catch (error) {
      this.logger.warn(`Commands directory ${this.commandsDir} not found or inaccessible`);
      return [];
    }
  }

  private async loadCommandFromFile(filePath: string): Promise<BaseCommand | null> {
    try {
      // TypeScriptファイルを動的にインポート
      const absolutePath = path.resolve(filePath);
      const module = await import(absolutePath);
      
      // エクスポートされたクラスを探す
      for (const exportName of Object.keys(module)) {
        const ExportedClass = module[exportName];
        
        if (typeof ExportedClass === 'function') {
          try {
            // BaseCommandを継承しているかテスト
            const instance = new ExportedClass(this.logger);
            if (instance instanceof BaseCommand) {
              return instance;
            }
          } catch (error) {
            // インスタンス化に失敗した場合はスキップ
            continue;
          }
        }
      }
      
      return null;
    } catch (error) {
      throw new Error(`Cannot load command from ${filePath}: ${error}`);
    }
  }

  convertToSlashCommand(command: BaseCommand): { name: string; description: string } {
    return {
      name: command.getName(),
      description: command.getDescription()
    };
  }

  convertToSlashCommands(commands: BaseCommand[]): { name: string; description: string }[] {
    return commands.map(command => this.convertToSlashCommand(command));
  }

  async getFileLastModified(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.mtime.getTime();
    } catch (error) {
      return 0;
    }
  }

  async hasCommandsChanged(lastCheckTime: number): Promise<boolean> {
    try {
      const commandFiles = await this.getCommandFiles();
      
      for (const file of commandFiles) {
        const lastModified = await this.getFileLastModified(file);
        if (lastModified > lastCheckTime) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.logger.warn(`Failed to check for command changes: ${error}`);
      return true; // エラー時は変更ありとして扱う
    }
  }
}