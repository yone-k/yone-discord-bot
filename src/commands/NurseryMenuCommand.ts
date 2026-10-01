import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { ApiNurseryMenuRepository } from '../api/Repositories';
import { buildNurseryMenuContainer, formatNurseryMenuDate, isBusinessDate, tokyoDate } from '../ui/NurseryMenuFormatter';

type NurseryMenuReader = Pick<ApiNurseryMenuRepository, 'get'>;

export class NurseryMenuCommand extends BaseCommand {
  static getCommandName(): string {
    return 'nursery-menu';
  }

  static getCommandDescription(): string {
    return '保育園の献立を表示します';
  }

  static getOptions(builder: SlashCommandBuilder): SlashCommandBuilder {
    return builder
      .addStringOption(option =>
        option
          .setName('day')
          .setDescription('表示する日（省略時は今日）')
          .setRequired(false)
          .addChoices({ name: '今日', value: 'today' }, { name: '明日', value: 'tomorrow' })
      )
      .addStringOption(option =>
        option
          .setName('date')
          .setDescription('表示する日付（YYYY-MM-DD）')
          .setRequired(false)
      ) as SlashCommandBuilder;
  }

  private readonly repository: NurseryMenuReader;

  constructor(logger: Logger, repository: NurseryMenuReader = new ApiNurseryMenuRepository()) {
    super('nursery-menu', '保育園の献立を表示します', logger);
    this.ephemeral = true;
    this.useThread = false;
    this.repository = repository;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'nursery-menu',
        'Interaction is required',
        'インタラクションが必要です。'
      );
    }

    const date = this.resolveDate(context.interaction.options.getString('day'), context.interaction.options.getString('date'));

    await context.interaction.deferReply({ flags: ['Ephemeral'] as const });
    const menu = await this.repository.get(date);
    if (!menu) {
      await context.interaction.editReply({ content: `${formatNurseryMenuDate(date)} の献立は登録されていません` });
      return;
    }
    await context.interaction.editReply({ components: [buildNurseryMenuContainer(menu)], flags: MessageFlags.IsComponentsV2 });
  }

  private resolveDate(day: string | null, date: string | null): string {
    if (day && date) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'nursery-menu',
        'Both day and date were specified',
        'day と date はどちらか一方だけ指定してください。'
      );
    }
    if (date !== null) {
      if (!isBusinessDate(date)) {
        throw new CommandError(
          CommandErrorType.INVALID_PARAMETERS,
          'nursery-menu',
          'Invalid date',
          'date は YYYY-MM-DD 形式の実在する日付で指定してください。'
        );
      }
      return date;
    }
    return tokyoDate(new Date(), day === 'tomorrow' ? 1 : 0);
  }
}
