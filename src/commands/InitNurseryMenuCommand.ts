import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { ApiNurseryMenuRepository } from '../api/Repositories';

type NurseryMenuChannelWriter = Pick<ApiNurseryMenuRepository, 'setChannel'>;

export class InitNurseryMenuCommand extends BaseCommand {
  static getCommandName(): string {
    return 'init-nursery-menu';
  }

  static getCommandDescription(): string {
    return 'このチャンネルを保育園の献立の投稿先に登録します';
  }

  private readonly repository: NurseryMenuChannelWriter;

  constructor(logger: Logger, repository: NurseryMenuChannelWriter = new ApiNurseryMenuRepository()) {
    super('init-nursery-menu', 'このチャンネルを保育園の献立の投稿先に登録します', logger);
    this.ephemeral = true;
    this.useThread = false;
    this.repository = repository;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'init-nursery-menu',
        'Interaction is required',
        'インタラクションが必要です。'
      );
    }

    if (!context.channelId) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'init-nursery-menu',
        'Channel ID is required',
        'チャンネルIDが必要です。'
      );
    }

    await context.interaction.deferReply({ flags: ['Ephemeral'] as const });
    await this.repository.setChannel(context.channelId);
    await context.interaction.deleteReply();
  }
}
