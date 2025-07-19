import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { Config, ConfigError } from '../src/utils/config';
import { Logger, LogLevel } from '../src/utils/logger';

class CommandDeployer {
  private rest: REST;
  private config: Config;
  private logger: Logger;

  constructor() {
    try {
      this.config = Config.getInstance();
      this.logger = new Logger(this.getLogLevelFromString(this.config.getLogLevel()));
      
      const token = this.config.getDiscordToken();
      this.rest = new REST({ version: '10' }).setToken(token);
    } catch (error) {
      console.error('Failed to initialize CommandDeployer:', error);
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

  private getCommands(): object[] {
    const commands = [
      new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!')
        .toJSON(),
      
      new SlashCommandBuilder()
        .setName('echo')
        .setDescription('Echoes your message')
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('The message to echo')
            .setRequired(true)
        )
        .toJSON(),
      
      new SlashCommandBuilder()
        .setName('info')
        .setDescription('Shows bot information')
        .toJSON()
    ];

    return commands;
  }

  public async deployToGuild(guildId: string): Promise<void> {
    try {
      this.logger.info(`Deploying commands to guild: ${guildId}`);
      
      const commands = this.getCommands();
      const clientId = this.config.getClientId();

      this.logger.info(`Started refreshing ${commands.length} application (/) commands for guild.`);

      const data = await this.rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      ) as { name: string }[];

      this.logger.info(`Successfully reloaded ${data.length} application (/) commands for guild.`);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to deploy commands to guild: ${error.message}`);
      } else {
        this.logger.error('Failed to deploy commands to guild: Unknown error');
      }
      throw error;
    }
  }

  public async deployGlobally(): Promise<void> {
    try {
      this.logger.info('Deploying commands globally');
      
      const commands = this.getCommands();
      const clientId = this.config.getClientId();

      this.logger.info(`Started refreshing ${commands.length} application (/) commands globally.`);

      const data = await this.rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      ) as { name: string }[];

      this.logger.info(`Successfully reloaded ${data.length} application (/) commands globally.`);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to deploy commands globally: ${error.message}`);
      } else {
        this.logger.error('Failed to deploy commands globally: Unknown error');
      }
      throw error;
    }
  }

  public async deleteGuildCommands(guildId: string): Promise<void> {
    try {
      this.logger.info(`Deleting all commands from guild: ${guildId}`);
      
      const clientId = this.config.getClientId();

      await this.rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: [] }
      );

      this.logger.info('Successfully deleted all guild commands.');
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to delete guild commands: ${error.message}`);
      } else {
        this.logger.error('Failed to delete guild commands: Unknown error');
      }
      throw error;
    }
  }

  public async deleteGlobalCommands(): Promise<void> {
    try {
      this.logger.info('Deleting all global commands');
      
      const clientId = this.config.getClientId();

      await this.rest.put(
        Routes.applicationCommands(clientId),
        { body: [] }
      );

      this.logger.info('Successfully deleted all global commands.');
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to delete global commands: ${error.message}`);
      } else {
        this.logger.error('Failed to delete global commands: Unknown error');
      }
      throw error;
    }
  }
}

async function main(): Promise<void> {
  try {
    const deployer = new CommandDeployer();
    const config = Config.getInstance();
    
    const args = process.argv.slice(2);
    const action = args[0] || 'deploy';
    
    switch (action) {
    case 'deploy': {
      const guildId = config.getGuildId();
      if (guildId) {
        console.log('Deploying to guild (development mode)');
        await deployer.deployToGuild(guildId);
      } else {
        console.log('No GUILD_ID specified, deploying globally');
        await deployer.deployGlobally();
      }
      break;
    }
        
    case 'deploy-global':
      console.log('Deploying globally');
      await deployer.deployGlobally();
      break;
        
    case 'delete': {
      const deleteGuildId = config.getGuildId();
      if (deleteGuildId) {
        console.log('Deleting guild commands');
        await deployer.deleteGuildCommands(deleteGuildId);
      } else {
        console.log('No GUILD_ID specified, deleting global commands');
        await deployer.deleteGlobalCommands();
      }
      break;
    }
        
    case 'delete-global':
      console.log('Deleting global commands');
      await deployer.deleteGlobalCommands();
      break;
        
    default:
      console.log('Usage: npm run deploy-commands [deploy|deploy-global|delete|delete-global]');
      console.log('  deploy        - Deploy to guild (if GUILD_ID set) or globally');
      console.log('  deploy-global - Deploy globally');
      console.log('  delete        - Delete guild commands (if GUILD_ID set) or global commands');
      console.log('  delete-global - Delete global commands');
      process.exit(1);
    }
    
    console.log('Command deployment completed successfully!');
    
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