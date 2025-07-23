import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from '../utils/logger';

interface CommandInfo {
  name: string;
  description: string;
}

export class CommandAutoDiscovery {
  private logger: Logger;
  private commandsDir: string;

  constructor(logger: Logger, commandsDir: string = 'src/commands') {
    this.logger = logger;
    this.commandsDir = commandsDir;
  }

  async discoverCommands(): Promise<CommandInfo[]> {
    try {
      this.logger.debug(`Discovering commands in ${this.commandsDir}`);
      
      const commandFiles = await this.getCommandFiles();
      const commands: CommandInfo[] = [];

      for (const file of commandFiles) {
        try {
          const command = await this.loadCommandInfoFromFile(file);
          if (command) {
            commands.push(command);
            this.logger.debug(`Loaded command: ${command.name}`);
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
    } catch {
      this.logger.warn(`Commands directory ${this.commandsDir} not found or inaccessible`);
      return [];
    }
  }

  private async loadCommandInfoFromFile(filePath: string): Promise<CommandInfo | null> {
    try {
      // TypeScriptファイルを動的にインポート
      const absolutePath = path.resolve(filePath);
      const module = await import(absolutePath);
      
      // エクスポートされたクラスを探す
      for (const exportName of Object.keys(module)) {
        const ExportedClass = module[exportName];
        
        if (typeof ExportedClass === 'function') {
          // 静的メソッドの存在を確認
          if (typeof ExportedClass.getCommandName === 'function' && 
              typeof ExportedClass.getCommandDescription === 'function') {
            try {
              const name = ExportedClass.getCommandName();
              const description = ExportedClass.getCommandDescription();
              return { name, description };
            } catch (error) {
              this.logger.debug(`Failed to get command info from ${exportName} in ${filePath}: ${error}`);
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      throw new Error(`Cannot load command from ${filePath}: ${error}`);
    }
  }

  convertToSlashCommand(command: CommandInfo): { name: string; description: string } {
    return {
      name: command.name,
      description: command.description
    };
  }

  convertToSlashCommands(commands: CommandInfo[]): { name: string; description: string }[] {
    return commands.map(command => this.convertToSlashCommand(command));
  }

  async getFileLastModified(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.mtime.getTime();
    } catch {
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