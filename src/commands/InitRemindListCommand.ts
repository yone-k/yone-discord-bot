import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { RemindInitializationService } from '../services/RemindInitializationService';

export class InitRemindListCommand extends BaseCommand {
  static getCommandName(): string {
    return 'init-remind-list';
  }

  static getCommandDescription(): string {
    return 'リマインドリストの初期化を行います';
  }

  private initializationService: RemindInitializationService;

  constructor(logger: Logger, initializationService?: RemindInitializationService) {
    super('init-remind-list', 'リマインドリストの初期化を行います', logger);
    this.ephemeral = true;
    this.useThread = false;
    this.initializationService = initializationService || new RemindInitializationService();
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'init-remind-list',
        'Interaction is required',
        'インタラクションが必要です。'
      );
    }

    await context.interaction.deferReply({ flags: ['Ephemeral'] as const });

    if (!context.channelId) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'init-remind-list',
        'Channel ID is required',
        'チャンネルIDが必要です。'
      );
    }

    const channelName = (context.interaction.channel && 'name' in context.interaction.channel)
      ? context.interaction.channel.name
      : 'リマインド';
    const listTitle = `${channelName}リマインド`;

    const result = await this.initializationService.initialize(
      context.channelId,
      context.interaction.client,
      listTitle
    );

    if (!result.success) {
      throw new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'init-remind-list',
        result.message || 'Initialization failed',
        'リマインドリストの初期化に失敗しました。'
      );
    }

    await context.interaction.deleteReply();
  }
}
