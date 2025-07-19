import { Client, GatewayIntentBits, Events, Collection, SlashCommandBuilder } from 'discord.js';
import { PingCommand } from './presentation/commands/PingCommand';
import { PingUseCase } from './application/usecases/PingUseCase';
import { DiscordClient } from './infrastructure/discord/DiscordClient';

// 環境変数の型定義
interface Environment {
  DISCORD_TOKEN: string;
  NODE_ENV: string;
}

// 環境変数の検証
function validateEnvironment(): Environment {
  const token = process.env.DISCORD_TOKEN;
  const nodeEnv = process.env.NODE_ENV || 'development';

  if (!token) {
    throw new Error('DISCORD_TOKEN environment variable is required');
  }

  return {
    DISCORD_TOKEN: token,
    NODE_ENV: nodeEnv
  };
}

// コマンドの型定義
interface Command {
  data: SlashCommandBuilder | any;
  execute: (interaction: any) => Promise<void>;
}

class YoneDiscordBot {
  private client: Client;
  private commands: Collection<string, Command>;
  private discordClient: DiscordClient;

  constructor() {
    // Discord.js クライアントの初期化
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.commands = new Collection();
    this.discordClient = new DiscordClient();

    this.setupEventHandlers();
    this.registerCommands();
  }

  // イベントハンドラーの設定
  private setupEventHandlers(): void {
    // Bot準備完了イベント
    this.client.once(Events.ClientReady, (readyClient) => {
      console.log(`✅ Bot is ready! Logged in as ${readyClient.user.tag}`);
      console.log(`🔗 Serving ${readyClient.guilds.cache.size} guilds`);
    });

    // スラッシュコマンドインタラクション処理
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);

      if (!command) {
        console.error(`❌ No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
        console.log(`✅ Command ${interaction.commandName} executed successfully`);
      } catch (error) {
        console.error(`❌ Error executing command ${interaction.commandName}:`, error);
        
        // エラー応答
        const errorMessage = 'There was an error while executing this command!';
        
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      }
    });

    // エラーハンドリング
    this.client.on(Events.Error, (error) => {
      console.error('❌ Discord client error:', error);
    });

    // 警告ハンドリング
    this.client.on(Events.Warn, (warning) => {
      console.warn('⚠️ Discord client warning:', warning);
    });

    // プロセス終了時の処理
    process.on('SIGINT', () => {
      console.log('🔄 Received SIGINT, shutting down gracefully...');
      this.client.destroy();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('🔄 Received SIGTERM, shutting down gracefully...');
      this.client.destroy();
      process.exit(0);
    });

    // 未処理の例外をキャッチ
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
      this.client.destroy();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    });
  }

  // コマンドの登録
  private registerCommands(): void {
    try {
      // PingCommand の登録（DDD アーキテクチャに基づく）
      const pingUseCase = new PingUseCase();
      const pingCommand = new PingCommand(pingUseCase, this.discordClient);
      
      this.commands.set(pingCommand.data.name, pingCommand);
      
      console.log(`📝 Registered command: ${pingCommand.data.name}`);
    } catch (error) {
      console.error('❌ Error registering commands:', error);
      throw error;
    }
  }

  // Bot の起動
  public async start(): Promise<void> {
    try {
      const env = validateEnvironment();
      
      console.log('🚀 Starting Yone Discord Bot...');
      console.log(`🔧 Environment: ${env.NODE_ENV}`);
      
      await this.client.login(env.DISCORD_TOKEN);
    } catch (error) {
      console.error('❌ Failed to start bot:', error);
      process.exit(1);
    }
  }
}

// メイン実行部分
async function main(): Promise<void> {
  try {
    const bot = new YoneDiscordBot();
    await bot.start();
  } catch (error) {
    console.error('💥 Fatal error starting bot:', error);
    process.exit(1);
  }
}

// アプリケーション開始
if (require.main === module) {
  main();
}

export { YoneDiscordBot };