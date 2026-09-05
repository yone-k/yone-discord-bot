export interface BotConfig {
  discordToken: string
  clientId: string
  guildId?: string
  nodeEnv: string
  logLevel: string
  databaseUrl: string
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class Config {
  private static instance: Config;
  private config: BotConfig;

  private constructor() {
    this.config = this.loadConfig();
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  private loadConfig(): BotConfig {
    const requiredEnvVars = ['DISCORD_BOT_TOKEN', 'CLIENT_ID', 'DATABASE_URL'];
    const missingVars: string[] = [];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar] || process.env[envVar]!.trim() === '') {
        missingVars.push(envVar);
      }
    }

    if (missingVars.length > 0) {
      throw new ConfigError(
        `Missing required environment variables: ${missingVars.join(', ')}. ` +
        'Please check your .env file and ensure all required variables are set.'
      );
    }

    const discordToken = process.env.DISCORD_BOT_TOKEN!;
    const clientId = process.env.CLIENT_ID!;
    const guildId = process.env.GUILD_ID;
    const nodeEnv = process.env.NODE_ENV || 'development';
    const logLevel = process.env.LOG_LEVEL || 'info';

    const databaseUrl = process.env.DATABASE_URL!.trim();
    try {
      const parsed = new URL(databaseUrl);
      if (!['postgresql:', 'postgres:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) throw new Error();
    } catch {
      throw new ConfigError('DATABASE_URL must use postgresql:// or postgres:// with a host and database name');
    }

    return {
      discordToken,
      clientId,
      guildId,
      nodeEnv,
      logLevel,
      databaseUrl
    };
  }

  public get(): BotConfig {
    return { ...this.config };
  }

  public getDiscordToken(): string {
    return this.config.discordToken;
  }

  public getClientId(): string {
    return this.config.clientId;
  }

  public getGuildId(): string | undefined {
    return this.config.guildId;
  }

  public getNodeEnv(): string {
    return this.config.nodeEnv;
  }

  public getLogLevel(): string {
    return this.config.logLevel;
  }

  public isDevelopment(): boolean {
    return this.config.nodeEnv === 'development';
  }

  public isProduction(): boolean {
    return this.config.nodeEnv === 'production';
  }

  public getDatabaseUrl(): string { return this.config.databaseUrl; }
}
