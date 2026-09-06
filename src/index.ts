import 'dotenv/config';
import express from 'express';
import { Server } from 'http';
import { Client, GatewayIntentBits, Events, ChatInputCommandInteraction, MessageReaction, User } from 'discord.js';
import { Config, ConfigError } from './utils/config';
import { Logger, LogLevel } from './utils/logger';
import { CommandManager } from './utils/CommandManager';
import { CommandExecutionContext } from './base/BaseCommand';
import { registerAllCommands } from './registry/RegisterCommands';
import { ReactionManager } from './services/ReactionManager';
import { LoggerManager } from './utils/LoggerManager';
import { ConsoleMigrationHelper } from './utils/ConsoleMigrationHelper';
import { ModalManager } from './services/ModalManager';
import { ButtonManager } from './services/ButtonManager';
import { registerAllButtons } from './registry/RegisterButtons';
import { registerAllModals } from './registry/RegisterModals';
import { SelectMenuManager } from './services/SelectMenuManager';
import { registerAllSelectMenus } from './registry/RegisterSelectMenus';
import { OperationLogService } from './services/OperationLogService';
import { ListChannelStore } from './services/ListChannelStore';
import { NotificationScheduler } from './services/NotificationScheduler';
import { AutocompleteManager } from './services/AutocompleteManager';
import { registerAllAutocompletes } from './registry/RegisterAutocompletes';
import { coreClient } from './api/CoreClient';
import { CoreLifecycle } from './services/CoreLifecycle';
import { refreshStoredDisplays } from './services/StartupDisplayRefresh';
import { RemindChannelStore } from './services/RemindChannelStore';
import { hydrateListItem, hydrateTask } from './api/Repositories';
import type { Schema } from './api/contracts';
import { fromStoredTask, RemindTaskRepository } from './services/RemindTaskRepository';
import { RemindInitializationService } from './services/RemindInitializationService';
import { MessageManager } from './services/MessageManager';
import { InventoryMessageManager } from './services/InventoryMessageManager';
import { RemindMessageManager } from './services/RemindMessageManager';
import { ListFormatter } from './ui/ListFormatter';
import { toDisplayListItem } from './utils/ListInput';

class DiscordBot {
  private client: Client;
  private config: Config;
  private logger: Logger;
  private commandManager: CommandManager;
  private reactionManager!: ReactionManager;
  private modalManager!: ModalManager;
  private buttonManager!: ButtonManager;
  private selectMenuManager!: SelectMenuManager;
  private autocompleteManager!: AutocompleteManager;
  private httpServer!: express.Application;
  private server: Server | null = null;
  private operationLogService!: OperationLogService;
  private metadataManager!: ListChannelStore;
  private remindScheduler!: NotificationScheduler;
  private coreLifecycle = new CoreLifecycle(() => coreClient().assertReady());

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
      this.setupHealthCheckServer();
    } catch (error) {
      const logger = LoggerManager.getLogger('DiscordBot');
      logger.error('Failed to initialize Discord Bot', 
        ConsoleMigrationHelper.createMetadata('DiscordBot', 'constructor', { error: String(error) }));
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
      // ListChannelStoreとOperationLogServiceを初期化
      this.metadataManager = ListChannelStore.getInstance();
      this.operationLogService = new OperationLogService(this.logger, this.metadataManager);
      
      this.reactionManager = new ReactionManager(this.logger);
      this.modalManager = new ModalManager(this.logger);
      this.buttonManager = new ButtonManager(this.logger, this.operationLogService, this.metadataManager);
      this.selectMenuManager = new SelectMenuManager(this.logger, this.operationLogService, this.metadataManager);
      this.autocompleteManager = new AutocompleteManager();

      // 新しいレジストリ関数を使用してハンドラーを登録
      registerAllButtons(this.buttonManager, this.logger, this.operationLogService, this.metadataManager);
      registerAllModals(this.modalManager, this.logger);
      registerAllSelectMenus(this.selectMenuManager, this.logger, this.operationLogService, this.metadataManager);
      registerAllAutocompletes(this.autocompleteManager, this.logger);

      this.logger.info('Button, select menu, modal and autocomplete handlers registered successfully');
    } catch (error) {
      this.logger.error('Failed to register button handlers', { error });
      throw error;
    }
  }

  private setupHealthCheckServer(): void {
    this.httpServer = express();
    
    this.httpServer.get('/health', async (req, res) => {
      const apiHealth = await this.coreLifecycle.health(this.client.isReady());
      const healthStatus = {
        status: apiHealth.ready ? 'ok' : 'unavailable',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        bot: {
          ready: apiHealth.ready,
          guilds: this.client.guilds.cache.size
        },
        api: apiHealth.api
      };
      
      res.status(apiHealth.statusCode).json(healthStatus);
    });

    this.httpServer.get('/', (req, res) => {
      res.status(200).json({ message: 'Discord Bot is running' });
    });
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
              flags: ['Ephemeral'] as const
            });
          } else {
            await interaction.reply({
              content: `❌ ${errorMessage}`,
              flags: ['Ephemeral'] as const
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
            flags: ['Ephemeral'] as const
          });
        } else {
          await interaction.reply({
            content: `❌ ${errorMessage}`,
            flags: ['Ephemeral'] as const
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
    this.client.once(Events.ClientReady, async () => {
      this.logger.info(`Bot is ready! Logged in as ${this.client.user?.tag}`);
      
      // 起動時に統計情報をログ出力
      this.commandManager.logExecutionSummary();

      this.coreLifecycle.initializeDisplays(
        () => this.refreshDisplays(),
        () => {
          this.remindScheduler = new NotificationScheduler();
          this.remindScheduler.start(this.client);
        },
        error => this.logger.error('Startup display refresh failed; retrying in 60 seconds', { error: error instanceof Error ? error.message : 'Unknown error' })
      );

    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await this.handleChatInputCommand(interaction);
        } else if (interaction.isButton()) {
          await this.buttonManager.handleButtonInteraction(interaction);
        } else if (interaction.isStringSelectMenu()) {
          await this.selectMenuManager.handleSelectMenuInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
          await this.modalManager.handleModalSubmit(interaction);
        } else if (interaction.isAutocomplete()) {
          await this.autocompleteManager.dispatch(interaction);
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
      
      // HTTPサーバーを起動
      const port = process.env.PORT || 3000;
      this.server = this.httpServer.listen(port, () => {
        this.logger.info(`Health check server started on port ${port}`);
      });
      
      const token = this.config.getDiscordToken();
      await this.coreLifecycle.connect(() => this.client.login(token));
      
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
      this.remindScheduler?.stop();
      this.coreLifecycle.stop();
      
      // HTTPサーバーを停止
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server!.close(() => {
            this.logger.info('Health check server stopped');
            resolve();
          });
        });
      }
      
      this.client.destroy();
      
      this.logger.info('Discord Bot shutdown complete');
      process.exit(0);
    } catch (error) {
      this.logger.error(`Error during shutdown: ${error}`);
      process.exit(1);
    }
  }

  private async refreshDisplays(): Promise<void> {
    const remindStore = RemindChannelStore.getInstance();
    const snapshot = await coreClient().request<Schema['Initialization']>('GET', '/v1/display/initialization');
    const messages = new MessageManager();
    const reminderMessages = new RemindMessageManager();
    const reminderInitialization = new RemindInitializationService(new RemindTaskRepository(), remindStore, reminderMessages);
    const failures = await refreshStoredDisplays([
      { list: (): Promise<{ channelId: string }[]> => Promise.resolve(snapshot.lists.map(display => display.channel)), render: async ({ channelId }): Promise<void> => {
        const display = snapshot.lists.find(value => value.channel.channelId === channelId)!;
        const metadata = display.channel;
        const items = display.items.map(hydrateListItem).map(toDisplayListItem);
        const content = await ListFormatter.formatDataListContent(metadata.listTitle, items, channelId, metadata.defaultCategory);
        const result = await messages.createOrUpdateMessageWithMetadataV2(channelId, ListFormatter.buildListComponents(content), metadata.listTitle, this.client, 'list');
        if (!result.success) throw new Error(result.errorMessage);
      } },
      { list: (): Promise<{ channelId: string }[]> => Promise.resolve(snapshot.inventories.map(display => display.channel)), render: async ({ channelId }): Promise<void> => {
        const display = snapshot.inventories.find(value => value.channel.channelId === channelId)!;
        const items = display.items.map(item => ({ ...item, category: item.category ?? '' }));
        const result = await InventoryMessageManager.getInstance().createOrUpdateMessage(channelId, items, display.channel.listTitle, this.client);
        if (!result.success) throw new Error(result.errorMessage);
      } },
      { list: (): Promise<{ channelId: string }[]> => Promise.resolve(snapshot.remindChannels), render: async ({ channelId }): Promise<void> => {
        const metadata = snapshot.remindChannels.find(channel => channel.channelId === channelId)!;
        const result = await reminderMessages.ensureReminderThread(channelId, this.client, metadata.remindNoticeThreadId ?? undefined, metadata.remindNoticeMessageId ?? undefined);
        if (!result.success || !result.threadId || !result.parentMessageId) throw new Error(result.message);
        await remindStore.updateChannelMetadata(channelId, { remindNoticeThreadId: result.threadId, remindNoticeMessageId: result.parentMessageId });
        for (const display of snapshot.reminders.filter(value => value.channel.channelId === channelId)) {
          const task = fromStoredTask(hydrateTask(display.task));
          const rendered = await reminderInitialization.syncTaskMessage(channelId, task, this.client);
          if (!rendered.success) throw new Error(rendered.message);
        }
      } }
    ]);
    for (const failure of failures) this.logger.error('Startup display refresh failed', failure);
    if (failures.length) throw new Error('起動時の表示更新が完了しませんでした');
  }
}

async function main(): Promise<void> {
  try {
    const bot = new DiscordBot();
    await bot.start();
  } catch (error) {
    const logger = LoggerManager.getLogger('Main');
    if (error instanceof ConfigError) {
      logger.error('Configuration Error', 
        ConsoleMigrationHelper.createMetadata('Main', 'main', { errorMessage: error.message }));
    } else if (error instanceof Error) {
      logger.error('Error occurred', 
        ConsoleMigrationHelper.createMetadata('Main', 'main', { errorMessage: error.message }));
    } else {
      logger.error('Unknown error occurred', 
        ConsoleMigrationHelper.createMetadata('Main', 'main', { error: String(error) }));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  const logger = LoggerManager.getLogger('Main');
  logger.error('Fatal error', 
    ConsoleMigrationHelper.createMetadata('Main', 'main.catch', { error: String(error) }));
  process.exit(1);
});

export {};
