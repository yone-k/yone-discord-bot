import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';

export class PingCommand extends BaseCommand {
  static getCommandName(): string {
    return 'ping';
  }

  static getCommandDescription(): string {
    return 'Bot の疎通確認を行います（レスポンス時間測定付き）';
  }

  constructor(logger: Logger) {
    super('ping', 'Bot の疎通確認を行います（レスポンス時間測定付き）', logger);
    this.useThread = false;  // pingコマンドはスレッドを使用しない
    this.ephemeral = true;   // 応答を本人にのみ表示
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    this.logger.debug('Ping command started', {
      userId: context?.userId,
      guildId: context?.guildId
    });
    
    const startTime = performance.now();
    
    // 疎通確認処理をシミュレート
    await new Promise(resolve => setTimeout(resolve, 0));
    
    const endTime = performance.now();
    const responseTime = endTime - startTime;
    
    this.logger.info(`Pong! Response time: ${responseTime.toFixed(2)}ms`, {
      responseTime: responseTime.toFixed(2),
      userId: context?.userId
    });
    
    // Discordのインタラクションがある場合はレスポンスを送信
    if (context?.interaction) {
      const replyOptions = this.ephemeral
        ? { content: `🏓 Pong! レスポンス時間: ${responseTime.toFixed(2)}ms`, flags: ['Ephemeral'] as const }
        : { content: `🏓 Pong! レスポンス時間: ${responseTime.toFixed(2)}ms` };
      await context.interaction.reply(replyOptions);
    }
    
    this.logger.debug('Ping command completed');
  }
}
