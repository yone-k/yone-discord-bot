import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { MessageManager } from '../services/MessageManager';
import { ListChannelStore } from '../services/ListChannelStore';
import { PostgresListRepository } from '../repositories/PostgresListRepository';
import { ListInitializationService } from '../services/ListInitializationService';
import { validateCategory, DEFAULT_CATEGORY } from '../models/CategoryType';
import { SlashCommandBuilder } from 'discord.js';
export class InitListCommand extends BaseCommand {
  static getCommandName(): string { return 'init-list'; }
  static getCommandDescription(): string { return 'リストの初期化を行います'; }
  static getOptions(builder: SlashCommandBuilder): SlashCommandBuilder {
    return builder.addStringOption(option => option.setName('default-category').setDescription('デフォルトカテゴリーを設定します').setRequired(false))
      .addBooleanOption(option => option.setName('enable-log').setDescription('操作ログを有効にします').setRequired(false)) as SlashCommandBuilder;
  }
  constructor(logger: Logger, private metadataManager: ListChannelStore = ListChannelStore.getInstance(), private listInitializationService: ListInitializationService = new ListInitializationService(new PostgresListRepository(), new MessageManager(), metadataManager)) {
    super('init-list', 'リストの初期化を行います', logger);
    this.deleteOnSuccess = true;
    this.ephemeral = true;
  }
  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.channelId || !context.interaction)
      throw new Error('チャンネルIDとインタラクションが必要です');
    const supplied = context.interaction.options.getString('default-category');
    const existing = await this.metadataManager.getChannelMetadata(context.channelId);
    const category = supplied ? validateCategory(supplied) : existing.metadata?.defaultCategory || DEFAULT_CATEGORY;
    const result = await this.listInitializationService.initializeList(context, context.interaction.options.getBoolean('enable-log'), category);
    if (!result.success)
      throw new Error(result.errorMessage || 'リストの初期化に失敗しました');
    await context.interaction.editReply({ content: `✅ ${result.itemCount ?? 0}件のアイテムを表示しました` });
  }
}
