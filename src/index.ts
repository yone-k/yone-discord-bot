import 'dotenv/config';
import { Client, GatewayIntentBits, Events, ChatInputCommandInteraction, MessageReaction, User } from 'discord.js';
import { Config, ConfigError } from './utils/config';
import { Logger, LogLevel } from './utils/logger';
import { CommandManager } from './utils/CommandManager';
import { CommandExecutionContext } from './base/BaseCommand';
import { registerAllCommands } from './registry/RegisterCommands';
import { ReactionManager } from './services/ReactionManager';
import { ModalManager } from './services/ModalManager';
import { ButtonManager } from './services/ButtonManager';
import { InitListButtonHandler } from './buttons/InitListButtonHandler';
import { EditListButtonHandler } from './buttons/EditListButtonHandler';
import { EditListModalHandler } from './modals/EditListModalHandler';

class DiscordBot {
  private client: Client;
  private config: Config;
  private logger: Logger;
  private commandManager: CommandManager;
  private reactionManager!: ReactionManager;
  private modalManager!: ModalManager;
  private buttonManager!: ButtonManager;

  constructor() {
    try {
      this.config = Config.getInstance();
      this.logger = new Logger(this.getLogLevelFromString(this.config.getLogLevel()));
      this.commandManager = new CommandManager(this.logger);
      
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.GuildMessageReactions
        ]
      });

      this.registerCommands();
      this.registerReactionAndModalHandlers();
      this.setupEventHandlers();
    } catch (error) {
      console.error('Failed to initialize Discord Bot:', error);
      process.exit(1);
    }
  }

  private registerCommands(): void {
    try {
      registerAllCommands(this.commandManager, this.logger);
    } catch (error) {
      this.logger.error('Failed to register commands', { error });
      throw error;
    }
  }

  private registerReactionAndModalHandlers(): void {
    try {
      this.reactionManager = new ReactionManager(this.logger);
      this.modalManager = new ModalManager(this.logger);
      this.buttonManager = new ButtonManager(this.logger);

      const initListButtonHandler = new InitListButtonHandler(this.logger);
      const editListButtonHandler = new EditListButtonHandler(this.logger);
      const editListModalHandler = new EditListModalHandler(this.logger);

      this.buttonManager.registerHandler(initListButtonHandler);
      this.buttonManager.registerHandler(editListButtonHandler);
      this.modalManager.registerHandler(editListModalHandler);

      this.logger.info('Button and modal handlers registered successfully');
    } catch (error) {
      this.logger.error('Failed to register button handlers', { error });
      throw error;
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


  private async handleChatInputCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    this.logger.info(`Received command: ${interaction.commandName}`, {
      userId: interaction.user.id,
      guildId: interaction.guildId || 'DM',
      channelId: interaction.channelId
    });

    const context: CommandExecutionContext = {
      interaction,
      userId: interaction.user.id,
      guildId: interaction.guildId || undefined,
      channelId: interaction.channelId
    };

    try {
      const result = await this.commandManager.execute(interaction.commandName, context);
        
      if (!result.success && result.error) {
        // エラーの場合、ユーザーフレンドリーなメッセージを送信
        const errorMessage = result.error.userMessage || 'コマンドの実行中にエラーが発生しました。';
          
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
              content: `❌ ${errorMessage}`,
              ephemeral: true
            });
          } else {
            await interaction.reply({
              content: `❌ ${errorMessage}`,
              ephemeral: true
            });
          }
        } catch (replyError) {
          this.logger.error('Failed to send error message to user', {
            originalError: result.error.getErrorDetails(),
            replyError: replyError instanceof Error ? replyError.message : replyError
          });
        }
      }
    } catch (error) {
      this.logger.error('Unexpected error in interaction handler', {
        error: error instanceof Error ? error.message : error,
        commandName: interaction.commandName,
        userId: interaction.user.id
      });

      try {
        const errorMessage = '予期しないエラーが発生しました。管理者にお問い合わせください。';
          
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: `❌ ${errorMessage}`,
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: `❌ ${errorMessage}`,
            ephemeral: true
          });
        }
      } catch (replyError) {
        this.logger.error('Failed to send unexpected error message to user', {
          originalError: error instanceof Error ? error.message : error,
          replyError: replyError instanceof Error ? replyError.message : replyError
        });
      }
    }
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, () => {
      this.logger.info(`Bot is ready! Logged in as ${this.client.user?.tag}`);
      
      // 起動時に統計情報をログ出力
      this.commandManager.logExecutionSummary();
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await this.handleChatInputCommand(interaction);
        } else if (interaction.isButton()) {
          await this.buttonManager.handleButtonInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
          await this.modalManager.handleModalSubmit(interaction);
        }
      } catch (error) {
        this.logger.error('Error handling interaction', {
          error: error instanceof Error ? error.message : 'Unknown error',
          interactionType: interaction.type,
          userId: interaction.user.id,
          guildId: interaction.guildId
        });
      }
    });

    this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
      try {
        if (reaction.partial) {
          try {
            await reaction.fetch();
          } catch (fetchError) {
            this.logger.warn('Could not fetch partial reaction', { error: fetchError });
            return;
          }
        }
        await this.reactionManager.handleReaction(reaction as MessageReaction, user as User);
      } catch (error) {
        this.logger.error('Error handling message reaction', {
          error: error instanceof Error ? error.message : 'Unknown error',
          messageId: reaction.message.id,
          userId: user.id,
          emoji: reaction.emoji.name
        });
      }
    });

    this.client.on('error', (error) => {
      this.logger.error(`Discord client error: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
    });

    this.client.on('warn', (warning) => {
      this.logger.warn(`Discord client warning: ${warning}`);
    });

    this.client.on('rateLimit', (rateLimitInfo) => {
      this.logger.warn('Rate limit hit', {
        timeout: rateLimitInfo.timeout,
        limit: rateLimitInfo.limit,
        method: rateLimitInfo.method,
        path: rateLimitInfo.path,
        route: rateLimitInfo.route
      });
    });

    process.on('unhandledRejection', (error) => {
      this.logger.error(`Unhandled promise rejection: ${error}`, {
        error: error instanceof Error ? error.message : error
      });
    });

    process.on('uncaughtException', (error) => {
      this.logger.error(`Uncaught exception: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });

    process.on('SIGINT', () => {
      this.logger.info('Received SIGINT, shutting down gracefully...');
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      this.logger.info('Received SIGTERM, shutting down gracefully...');
      this.shutdown();
    });
  }

  public async start(): Promise<void> {
    try {
      this.logger.info('Starting Discord Bot...');
      
      const token = this.config.getDiscordToken();
      await this.client.login(token);
      
      this.logger.info('Discord Bot started successfully');
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to start Discord Bot: ${error.message}`);
      } else {
        this.logger.error('Failed to start Discord Bot: Unknown error');
      }
      process.exit(1);
    }
  }

  public async shutdown(): Promise<void> {
    try {
      this.logger.info('Shutting down Discord Bot...');
      
      // シャットダウン前に統計情報を出力
      this.commandManager.logExecutionSummary();
      
      this.client.destroy();
      
      this.logger.info('Discord Bot shutdown complete');
      process.exit(0);
    } catch (error) {
      this.logger.error(`Error during shutdown: ${error}`);
      process.exit(1);
    }
  }
}

async function main(): Promise<void> {
  try {
    const bot = new DiscordBot();
    await bot.start();
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

export {};