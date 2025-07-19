import { Command, CommandData, CommandResponse } from './Command.js';
import { CommandService } from '../services/CommandService.js';

/**
 * Pingコマンドのドメインロジック
 * Discord固有の処理を排除し、純粋なビジネスロジックのみを扱います
 */
export class PingCommand extends Command {
  public readonly data: CommandData = {
    name: 'ping',
    description: 'Replies with Pong!'
  };

  private commandService: CommandService;

  constructor(commandService?: CommandService) {
    super();
    this.commandService = commandService || new CommandService();
  }

  /**
   * Pingコマンドのドメインロジックを実行します
   * 応答時間を測定し、適切なレスポンスを生成します
   */
  public async execute(): Promise<CommandResponse> {
    const result = await this.executeWithTiming(async () => {
      return await this.commandService.generatePingResponseWithTiming();
    });

    return {
      content: result.result.message,
      ephemeral: false
    };
  }
}