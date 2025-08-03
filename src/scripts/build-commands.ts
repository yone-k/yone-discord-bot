import 'dotenv/config';
import { CommandAutoDiscovery, CommandWithClass } from './CommandAutoDiscovery';
import { Logger, LogLevel } from '../utils/logger';
import { Config, ConfigError } from '../utils/config';
import { REST, Routes, SlashCommandBuilder, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';

interface BuildCommandsOptions {
  environment?: 'development' | 'production'
  force?: boolean
  dryRun?: boolean
}

interface CommandWithOptions {
  name: string;
  description: string;
  commandClass?: { getOptions?: (builder: SlashCommandBuilder) => SlashCommandBuilder };
}

class CommandBuilder {
  private rest?: REST;
  private config?: Config;
  private logger: Logger;
  private discovery: CommandAutoDiscovery;

  constructor(buildOnly = false) {
    try {
      // ビルドのみの場合は最小限の初期化
      if (buildOnly) {
        this.logger = new Logger(LogLevel.INFO);
        this.discovery = new CommandAutoDiscovery(this.logger);
      } else {
        this.config = Config.getInstance();
        this.logger = new Logger(this.getLogLevelFromString(this.config.getLogLevel()));
        this.discovery = new CommandAutoDiscovery(this.logger);
        
        const token = this.config.getDiscordToken();
        this.rest = new REST({ version: '10' }).setToken(token);
      }
    } catch (error) {
      const logger = new Logger(LogLevel.ERROR);
      logger.error('Failed to initialize CommandBuilder:', { error: String(error) });
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
      const commands = await this.discovery.discoverCommandsWithClass();
      
      if (commands.length === 0) {
        this.logger.warn('No commands discovered. Deployment skipped.');
        return;
      }

      // SlashCommandBuilderに変換
      const commandsWithOptions = this.convertToCommandsWithOptions(commands);
      const slashCommands = this.buildSlashCommands(commandsWithOptions);
      
      this.logger.info(`Built ${slashCommands.length} slash commands`);

      // ビルドのみモードまたはドライランモードの場合はデプロイをスキップ
      if (options.dryRun || !this.config || !this.rest) {
        if (options.dryRun) {
          this.logger.info('Dry run mode - commands would be deployed:');
        } else {
          this.logger.info('Build-only mode - commands successfully built but not deployed:');
        }
        slashCommands.forEach(cmd => {
          this.logger.info(`  - ${cmd.name}: ${cmd.description}`);
          if (cmd.options && cmd.options.length > 0) {
            this.logger.info(`    Options: ${JSON.stringify(cmd.options, null, 2)}`);
          } else {
            this.logger.info('    No options');
          }
        });
        this.logger.info('Command build completed successfully');
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

  private convertToCommandsWithOptions(commands: CommandWithClass[]): CommandWithOptions[] {
    return commands.map(command => ({
      name: command.name,
      description: command.description,
      commandClass: command.commandClass && 
        (typeof command.commandClass === 'function' || typeof command.commandClass === 'object') &&
        'getOptions' in command.commandClass 
        ? command.commandClass as { getOptions?: (builder: SlashCommandBuilder) => SlashCommandBuilder }
        : undefined
    }));
  }

  private buildSlashCommands(commands: CommandWithOptions[]): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    return commands.map(command => {
      let builder = new SlashCommandBuilder()
        .setName(command.name)
        .setDescription(command.description);

      // コマンドクラスがgetOptionsメソッドを持つ場合、オプションを追加
      if (command.commandClass && typeof command.commandClass.getOptions === 'function') {
        builder = command.commandClass.getOptions(builder);
      }

      return builder.toJSON();
    });
  }

  private async deployCommands(commands: object[], options: BuildCommandsOptions): Promise<void> {
    if (!this.config || !this.rest) {
      throw new Error('Config and REST client are required for deployment');
    }
    
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
    const args = process.argv.slice(2);
    
    // ヘルプメッセージの表示（Configが不要）
    if (args.includes('--help')) {
      const logger = new Logger(LogLevel.INFO);
      logger.info('Usage: npm run build-commands [options]');
      logger.info('Options:');
      logger.info('  --production  Deploy commands globally');
      logger.info('  --force       Force rebuild even if no changes detected');
      logger.info('  --dry-run     Show what would be deployed without actually deploying');
      logger.info('  --check       Check for command changes without deploying');
      logger.info('  --help        Show this help message');
      return;
    }
    
    const options: BuildCommandsOptions = {
      environment: args.includes('--production') ? 'production' : 'development',
      force: args.includes('--force'),
      dryRun: args.includes('--dry-run')
    };

    // ビルドのみか実際のデプロイが必要かを判定
    const buildOnly = args.includes('--dry-run') || args.includes('--check') || 
                     (!args.includes('--production') && !process.env.DISCORD_BOT_TOKEN);
    
    const builder = new CommandBuilder(buildOnly);

    if (args.includes('--check')) {
      const logger = new Logger(LogLevel.INFO);
      const hasChanges = await builder.checkForUpdates();
      logger.info(hasChanges ? 'Changes detected' : 'No changes detected');
      process.exit(hasChanges ? 1 : 0);
    }

    await builder.buildAndDeploy(options);
    
  } catch (error) {
    const logger = new Logger(LogLevel.ERROR);
    if (error instanceof ConfigError) {
      logger.error(`Configuration Error: ${error.message}`);
    } else if (error instanceof Error) {
      logger.error(`Error: ${error.message}`);
    } else {
      logger.error('Unknown error occurred');
    }
    process.exit(1);
  }
}

main().catch((error) => {
  const logger = new Logger(LogLevel.ERROR);
  logger.error('Fatal error:', { error: String(error) });
  process.exit(1);
});