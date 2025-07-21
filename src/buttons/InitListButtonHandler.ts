import { ChatInputCommandInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { InitListCommand } from '../commands/InitListCommand';
import { CommandExecutionContext } from '../base/BaseCommand';

export class InitListButtonHandler extends BaseButtonHandler {
  private initListCommand: InitListCommand;

  constructor(logger: Logger, initListCommand?: InitListCommand) {
    super('init-list-button', logger);
    this.initListCommand = initListCommand || new InitListCommand(logger);
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<void> {
    await context.interaction.deferReply({ ephemeral: true });

    const commandContext: CommandExecutionContext = {
      interaction: context.interaction as unknown as ChatInputCommandInteraction,
      userId: context.interaction.user.id,
      guildId: context.interaction.guildId ?? undefined,
      channelId: context.interaction.channelId ?? undefined
    };

    await this.initListCommand.execute(commandContext);

    await context.interaction.editReply({
      content: '✅ リストの同期が完了しました！'
    });
  }
}