import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../../src/utils/logger';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';
import { MigrateInventoryCommand } from '../../src/commands/MigrateInventoryCommand';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('MigrateInventoryCommand', () => {
  let command: MigrateInventoryCommand;
  let mockLogger: MockLogger;
  let migrationService: {
    migrate: ReturnType<typeof vi.fn>;
  };
  let repository: {
    fetchAll: ReturnType<typeof vi.fn>;
  };
  let messageManager: {
    createOrUpdateMessage: ReturnType<typeof vi.fn>;
  };
  let interaction: {
    deferReply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    client: unknown;
  };
  let context: CommandExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = new MockLogger();
    migrationService = {
      migrate: vi.fn().mockResolvedValue({
        success: true,
        backupSheets: ['remind_list_task-channel-1_backup_20260509123456'],
        migratedTasks: 2,
        mergedItems: 1,
        conflictItems: [],
        skippedTasks: []
      })
    };
    repository = {
      fetchAll: vi.fn().mockResolvedValue([
        {
          id: 'inventory-1',
          name: '洗剤',
          stock: 5,
          category: '日用品'
        }
      ])
    };
    messageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
    };
    interaction = {
      deferReply: vi.fn(),
      editReply: vi.fn(),
      client: { user: { id: 'bot-user-1' } }
    };
    context = {
      channelId: 'inventory-channel-1',
      interaction: interaction as unknown as CommandExecutionContext['interaction']
    };

    command = new MigrateInventoryCommand(
      mockLogger as unknown as Logger,
      migrationService,
      repository,
      messageManager
    );
  });

  it('サービス成功時は editReply で成功レポートを ephemeral 表示する', async () => {
    // Given
    migrationService.migrate.mockResolvedValue({
      success: true,
      backupSheets: ['remind_list_task-channel-1_backup_20260509123456'],
      migratedTasks: 2,
      mergedItems: 1,
      conflictItems: [
        { name: '洗剤', stockValues: [3, 5], resolvedStock: 5 }
      ],
      skippedTasks: [
        { taskId: 'task-skipped', reason: '既に移行済みです' }
      ]
    });

    // When
    await command.execute(context);

    // Then
    expect(command.getName()).toBe('migrate-inventory');
    expect(command.getEphemeral()).toBe(true);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(migrationService.migrate).toHaveBeenCalledWith('inventory-channel-1');
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(messageManager.createOrUpdateMessage).toHaveBeenCalledWith(
      'inventory-channel-1',
      [
        {
          id: 'inventory-1',
          name: '洗剤',
          stock: 5,
          category: '日用品'
        }
      ],
      '在庫リスト',
      interaction.client
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('在庫移行が完了しました')
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('移行タスク数: 2')
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('統合アイテム数: 1')
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('バックアップ')
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('スキップ')
    });
  });

  it('サービス失敗時は editReply でエラーを ephemeral 表示する', async () => {
    // Given
    migrationService.migrate.mockResolvedValue({
      success: false,
      backupSheets: [],
      migratedTasks: 0,
      mergedItems: 0,
      conflictItems: [],
      skippedTasks: [],
      message: 'バックアップの作成に失敗しました'
    });

    // When
    await command.execute(context);

    // Then
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(migrationService.migrate).toHaveBeenCalledWith('inventory-channel-1');
    expect(repository.fetchAll).not.toHaveBeenCalled();
    expect(messageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('在庫移行に失敗しました')
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('バックアップの作成に失敗しました')
    });
  });
});
