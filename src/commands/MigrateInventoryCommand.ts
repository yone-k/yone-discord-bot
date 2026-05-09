import type { Client } from 'discord.js';
import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import type { InventoryItem } from '../models/InventoryItem';
import { InventoryMessageManager } from '../services/InventoryMessageManager';
import { InventoryMigrationService, type MigrationReport } from '../services/InventoryMigrationService';
import { InventoryRepository } from '../services/InventoryRepository';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { Logger } from '../utils/logger';

interface InventoryMigrationRunner {
  migrate(inventoryChannelId: string): Promise<MigrationReport>;
}

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

interface InventoryMessageManagerPort {
  createOrUpdateMessage(
    channelId: string,
    items: InventoryItem[],
    listTitle: string,
    client: Client
  ): Promise<{ success: boolean; errorMessage?: string }>;
}

export class MigrateInventoryCommand extends BaseCommand {
  static getCommandName(): string {
    return 'migrate-inventory';
  }

  static getCommandDescription(): string {
    return '既存タスク在庫を在庫専用シートに移行する';
  }

  constructor(
    logger: Logger,
    private readonly migrationService: InventoryMigrationRunner = new InventoryMigrationService(),
    private readonly repository: InventoryRepositoryPort = new InventoryRepository(),
    private readonly messageManager: InventoryMessageManagerPort = InventoryMessageManager.getInstance()
  ) {
    super('migrate-inventory', '既存タスク在庫を在庫専用シートに移行する', logger);
    this.useThread = false;
    this.ephemeral = true;
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    if (!context?.interaction) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'migrate-inventory',
        'Interaction is required',
        'インタラクションが必要です。'
      );
    }

    if (!context.channelId) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'migrate-inventory',
        'Channel ID is required',
        'チャンネルIDが必要です。'
      );
    }

    await context.interaction.deferReply({ flags: ['Ephemeral'] as const });

    const report = await this.migrationService.migrate(context.channelId);
    if (!report.success) {
      await context.interaction.editReply({
        content: `在庫移行に失敗しました。${report.message ?? ''}`.trim()
      });
      return;
    }

    const items = await this.repository.fetchAll(context.channelId);
    const messageResult = await this.messageManager.createOrUpdateMessage(
      context.channelId,
      items,
      '在庫リスト',
      context.interaction.client
    );
    if (!messageResult.success) {
      await context.interaction.editReply({
        content: messageResult.errorMessage || '在庫メッセージの更新に失敗しました'
      });
      return;
    }

    await context.interaction.editReply({
      content: [
        '在庫移行が完了しました。',
        `バックアップ: ${report.backupSheets.length}件`,
        `移行タスク数: ${report.migratedTasks}`,
        `統合アイテム数: ${report.mergedItems}`,
        `コンフリクト: ${report.conflictItems.length}件`,
        `スキップ: ${report.skippedTasks.length}件`
      ].join('\n')
    });
  }
}
