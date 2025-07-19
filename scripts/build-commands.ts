import 'dotenv/config';
import { CommandAutoDiscovery } from './CommandAutoDiscovery';
import { Logger, LogLevel } from '../src/utils/logger';
import { Config, ConfigError } from '../src/utils/config';
import { REST, Routes, SlashCommandBuilder, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import { BaseCommand } from '../src/base/BaseCommand';

interface BuildCommandsOptions {
  environment?: 'development' | 'production'
  force?: boolean
  dryRun?: boolean
}

class CommandBuilder {
  private rest: REST;
  private config: Config;
  private logger: Logger;
  private discovery: CommandAutoDiscovery;

  constructor() {
    try {
      this.config = Config.getInstance();
      this.logger = new Logger(this.getLogLevelFromString(this.config.getLogLevel()));
      this.discovery = new CommandAutoDiscovery(this.logger);
      
      const token = this.config.getDiscordToken();
      this.rest = new REST({ version: '10' }).setToken(token);
    } catch (error) {
      console.error('Failed to initialize CommandBuilder:', error);
      process.exit(1);
    }
  }

  private getLogLevelFromString(level: string): LogLevel {
    switch (level.toLowerCase()) {
    case 'debug':
      return LogLevel.DEBUG;
    case 'info':
      return LogLevel.INFO;
    case 'warn':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
    }
  }

  async buildAndDeploy(options: BuildCommandsOptions = {}): Promise<void> {
    try {
      this.logger.info('Starting command build and deployment process');
      
      // コマンドの自動検出
      const commands = await this.discovery.discoverCommands();
      
      if (commands.length === 0) {
        this.logger.warn('No commands discovered. Deployment skipped.');
        return;
      }

      // SlashCommandBuilderに変換
      const slashCommands = this.buildSlashCommands(commands);
      
      this.logger.info(`Built ${slashCommands.length} slash commands`);

      if (options.dryRun) {
        this.logger.info('Dry run mode - commands would be deployed:');
        slashCommands.forEach(cmd => {
          this.logger.info(`  - ${cmd.name}: ${cmd.description}`);
        });
        return;
      }

      // デプロイメント実行
      await this.deployCommands(slashCommands, options);
      
      this.logger.info('Command build and deployment completed successfully');
    } catch (error) {
      this.logger.error(`Command build and deployment failed: ${error}`);
      throw error;
    }
  }

  private buildSlashCommands(commands: BaseCommand[]): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    return commands.map(command => {
      const builder = new SlashCommandBuilder()
        .setName(command.getName())
        .setDescription(command.getDescription());

      // 追加のオプションがある場合は後で拡張可能
      return builder.toJSON();
    });
  }

  private async deployCommands(commands: object[], options: BuildCommandsOptions): Promise<void> {
    const clientId = this.config.getClientId();
    
    if (options.environment === 'production') {
      // グローバルデプロイメント
      this.logger.info('Deploying commands globally (production)');
      
      const data = await this.rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      ) as { name: string }[];

      this.logger.info(`Successfully deployed ${data.length} commands globally`);
    } else {
      // ギルドデプロイメント（開発環境）
      const guildId = this.config.getGuildId();
      
      if (!guildId) {
        throw new Error('GUILD_ID is required for development deployment');
      }

      this.logger.info(`Deploying commands to guild: ${guildId}`);
      
      const data = await this.rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      ) as { name: string }[];

      this.logger.info(`Successfully deployed ${data.length} commands to guild`);
    }
  }

  async checkForUpdates(lastBuildTime?: number): Promise<boolean> {
    const checkTime = lastBuildTime || 0;
    const hasChanges = await this.discovery.hasCommandsChanged(checkTime);
    
    if (hasChanges) {
      this.logger.info('Command changes detected');
    } else {
      this.logger.debug('No command changes detected');
    }
    
    return hasChanges;
  }
}

async function main(): Promise<void> {
  try {
    const builder = new CommandBuilder();
    const args = process.argv.slice(2);
    
    const options: BuildCommandsOptions = {
      environment: args.includes('--production') ? 'production' : 'development',
      force: args.includes('--force'),
      dryRun: args.includes('--dry-run')
    };

    if (args.includes('--help')) {
      console.log('Usage: npm run build-commands [options]');
      console.log('Options:');
      console.log('  --production  Deploy commands globally');
      console.log('  --force       Force rebuild even if no changes detected');
      console.log('  --dry-run     Show what would be deployed without actually deploying');
      console.log('  --help        Show this help message');
      return;
    }

    if (args.includes('--check')) {
      const hasChanges = await builder.checkForUpdates();
      console.log(hasChanges ? 'Changes detected' : 'No changes detected');
      process.exit(hasChanges ? 1 : 0);
    }

    await builder.buildAndDeploy(options);
    
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration Error: ${error.message}`);
    } else if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('Unknown error occurred');
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});