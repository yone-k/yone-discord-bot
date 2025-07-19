import { PingUseCase } from '../../application/usecases/PingUseCase';
import { DiscordClient, DiscordInteraction } from '../../infrastructure/discord/DiscordClient';

export class PingCommand {
  public data = {
    name: 'ping',
    description: 'Replies with Pong!'
  };

  constructor(
    private pingUseCase: PingUseCase,
    private discordClient: DiscordClient
  ) {}

  async execute(interaction: DiscordInteraction): Promise<void> {
    const result = await this.pingUseCase.execute();
    
    await this.discordClient.replyToInteraction(interaction, {
      content: result.message,
      ephemeral: false
    });
  }
}