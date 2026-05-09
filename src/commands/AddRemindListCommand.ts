import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { SlashCommandBuilder } from 'discord.js';
import { RemindTaskService, type RemindTaskInputData } from '../services/RemindTaskService';
import { parseRemindBeforeInput } from '../utils/RemindDuration';
import { parseInventoryInput } from '../utils/RemindInventory';
import { RemindMetadataManager } from '../services/RemindMetadataManager';
import { InventoryService } from '../services/InventoryService';

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
          .setDescription('期限時刻（時:分、未指定は00:00）')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('description')
          .setDescription('説明（任意）')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('remind-before')
          .setDescription('事前通知（日:時:分 もしくは 時:分）')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('inventory-items')
          .setDescription('在庫設定（例: フィルター,1.5,3 を改行 or ; で複数指定）')
          .setRequired(false)
      ) as SlashCommandBuilder;
  }

  private remindTaskService: RemindTaskService;
  private metadataManager: Pick<RemindMetadataManager, 'getChannelMetadata'>;
  private inventoryService: Pick<InventoryService, 'resolveByName'>;

  constructor(
    logger: Logger,
    remindTaskService?: RemindTaskService,
    metadataManager?: Pick<RemindMetadataManager, 'getChannelMetadata'>,
    inventoryService?: Pick<InventoryService, 'resolveByName'>
  ) {
    super('add-remind-list', 'リマインドタスクを追加します', logger);
    this.ephemeral = true;
    this.useThread = false;
    this.remindTaskService = remindTaskService || new RemindTaskService();
    this.metadataManager = metadataManager || RemindMetadataManager.getInstance();
    this.inventoryService = inventoryService || InventoryService.getInstance();
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

    await context.interaction.deferReply({ flags: ['Ephemeral'] as const });

    const title = context.interaction.options.getString('title', true);
    const description = context.interaction.options.getString('description') || undefined;
    const intervalDays = context.interaction.options.getInteger('interval-days', true);
    const timeOfDay = context.interaction.options.getString('time-of-day') || undefined;
    const remindBeforeText = context.interaction.options.getString('remind-before') ?? undefined;
    const inventoryText = context.interaction.options.getString('inventory-items') ?? undefined;
    let remindBeforeMinutes: number | undefined;
    if (remindBeforeText !== undefined) {
      try {
        remindBeforeMinutes = parseRemindBeforeInput(remindBeforeText);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid remind-before input';
        throw new CommandError(
          CommandErrorType.INVALID_PARAMETERS,
          'add-remind-list',
          message,
          message
        );
      }
    }

    let inventoryItems: RemindTaskInputData['inventoryItems'];
    if (inventoryText) {
      try {
        const parsedInventoryItems = parseInventoryInput(inventoryText);
        const metadataResult = await this.metadataManager.getChannelMetadata(context.channelId);
        const linkedInventoryChannelId = metadataResult.metadata?.linkedInventoryChannelId;
        if (!linkedInventoryChannelId) {
          throw new Error('在庫チャンネルが連携されていません');
        }
        inventoryItems = await Promise.all(parsedInventoryItems.map(async (item) => {
          const inventoryItem = await this.inventoryService.resolveByName(linkedInventoryChannelId, item.name);
          return {
            inventoryId: inventoryItem.id,
            consume: item.consume
          };
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid inventory input';
        throw new CommandError(
          CommandErrorType.INVALID_PARAMETERS,
          'add-remind-list',
          message,
          message
        );
      }
    }

    const result = await this.remindTaskService.addTask(
      context.channelId,
      {
        title,
        description,
        intervalDays,
        timeOfDay,
        remindBeforeMinutes,
        inventoryItems
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
