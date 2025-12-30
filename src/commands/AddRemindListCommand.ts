import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { SlashCommandBuilder } from 'discord.js';
import { RemindTaskService } from '../services/RemindTaskService';

export class AddRemindListCommand extends BaseCommand {
  static getCommandName(): string {
    return 'add-remind-list';
  }

  static getCommandDescription(): string {
    return 'リマインドタスクを追加します';
  }

  static getOptions(builder: SlashCommandBuilder): SlashCommandBuilder {
    return builder
      .addStringOption(option =>
        option.setName('title')
          .setDescription('タスク名')
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('interval-days')
          .setDescription('完了から次回期限までの日数')
          .setRequired(true)
          .setMinValue(1)
      )
      .addStringOption(option =>
        option.setName('time-of-day')
          .setDescription('期限時刻（HH:mm）')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('description')
          .setDescription('説明（任意）')
          .setRequired(false)
      )
      .addIntegerOption(option =>
        option.setName('remind-before')
          .setDescription('事前通知（分）')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(10080)
      ) as SlashCommandBuilder;
  }

  private remindTaskService: RemindTaskService;

  constructor(logger: Logger, remindTaskService?: RemindTaskService) {
    super('add-remind-list', 'リマインドタスクを追加します', logger);
    this.ephemeral = true;
    this.useThread = false;
    this.remindTaskService = remindTaskService || new RemindTaskService();
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'add-remind-list',
        'Interaction is required',
        'インタラクションが必要です。'
      );
    }

    if (!context.channelId) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'add-remind-list',
        'Channel ID is required',
        'チャンネルIDが必要です。'
      );
    }

    await context.interaction.deferReply({ ephemeral: true });

    const title = context.interaction.options.getString('title', true);
    const description = context.interaction.options.getString('description') || undefined;
    const intervalDays = context.interaction.options.getInteger('interval-days', true);
    const timeOfDay = context.interaction.options.getString('time-of-day', true);
    const remindBeforeMinutes = context.interaction.options.getInteger('remind-before') ?? undefined;

    const result = await this.remindTaskService.addTask(
      context.channelId,
      {
        title,
        description,
        intervalDays,
        timeOfDay,
        remindBeforeMinutes
      },
      context.interaction.client
    );

    if (!result.success) {
      throw new CommandError(
        CommandErrorType.EXECUTION_FAILED,
        'add-remind-list',
        result.message || 'Failed to add remind task',
        'リマインドタスクの登録に失敗しました。'
      );
    }

    await context.interaction.deleteReply();
  }
}
