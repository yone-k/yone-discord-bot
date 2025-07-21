export interface GoogleSheetsConfig {
  spreadsheetId: string
  serviceAccountEmail: string
  privateKey: string
}

export interface BotConfig {
  discordToken: string
  clientId: string
  guildId?: string
  nodeEnv: string
  logLevel: string
  googleSheets?: GoogleSheetsConfig
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
    const requiredEnvVars = ['DISCORD_BOT_TOKEN', 'CLIENT_ID'];
    const missingVars: string[] = [];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
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

    // Google Sheets設定の読み込み（オプショナル）
    const googleSheetsConfig = this.loadGoogleSheetsConfig();

    if (discordToken.trim() === '') {
      throw new ConfigError('DISCORD_BOT_TOKEN cannot be empty');
    }

    if (clientId.trim() === '') {
      throw new ConfigError('CLIENT_ID cannot be empty');
    }

    return {
      discordToken,
      clientId,
      guildId,
      nodeEnv,
      logLevel,
      googleSheets: googleSheetsConfig
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

  private loadGoogleSheetsConfig(): GoogleSheetsConfig | undefined {
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;

    // いずれかが未設定または空文字の場合はundefinedを返す
    if (!spreadsheetId || !serviceAccountEmail || !privateKey ||
        spreadsheetId.trim() === '' || serviceAccountEmail.trim() === '' || privateKey.trim() === '') {
      return undefined;
    }

    // PRIVATE_KEYの改行文字を正しく処理
    const processedPrivateKey = privateKey.replace(/\\n/g, '\n');

    return {
      spreadsheetId: spreadsheetId.trim(),
      serviceAccountEmail: serviceAccountEmail.trim(),
      privateKey: processedPrivateKey
    };
  }

  public getGoogleSheetsConfig(): GoogleSheetsConfig | undefined {
    return this.config.googleSheets;
  }
}