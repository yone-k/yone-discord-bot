import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../../src/utils/logger';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';
import { InitInventoryCommand } from '../../src/commands/InitInventoryCommand';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('InitInventoryCommand', () => {
  let command: InitInventoryCommand;
  let mockLogger: MockLogger;
  let initializationService: {
    initializeInventory: ReturnType<typeof vi.fn>;
  };
  let interaction: {
    client: Record<string, never>;
    channel: { name: string };
    deferReply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deleteReply: ReturnType<typeof vi.fn>;
  };
  let context: CommandExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = new MockLogger();
    initializationService = {
      initializeInventory: vi.fn().mockResolvedValue({ success: true })
    };
    interaction = {
      client: {},
      channel: { name: 'stock' },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };
    context = {
      channelId: 'inventory-channel-1',
      interaction: interaction as unknown as CommandExecutionContext['interaction']
    };

    command = new InitInventoryCommand(
      mockLogger as unknown as Logger,
      initializationService
    );
  });

  it('InventoryInitializationService が成功した場合は在庫管理を初期化して成功応答する', async () => {
    // Given
    initializationService.initializeInventory.mockResolvedValue({ success: true });

    // When
    await command.execute(context);

    // Then
    expect(command.getName()).toBe('init-inventory');
    expect(command.getDescription()).toBe('在庫管理を初期化する');
    expect(command.getEphemeral()).toBe(true);
    expect((command as unknown as { useThread: boolean }).useThread).toBe(false);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(initializationService.initializeInventory).toHaveBeenCalledWith({
      channelId: 'inventory-channel-1',
      listTitle: 'stockの在庫'
    });
    expect(interaction.deleteReply).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('InventoryInitializationService の例外をコマンド共通処理へ伝播する', async () => {
    // Given
    initializationService.initializeInventory.mockRejectedValue(new Error('設定の保存に失敗しました'));

    // When
    await expect(command.execute(context)).rejects.toThrow('設定の保存に失敗しました');

    // Then
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(initializationService.initializeInventory).toHaveBeenCalledWith({
      channelId: 'inventory-channel-1',
      listTitle: 'stockの在庫'
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.deleteReply).not.toHaveBeenCalled();
  });

  it('listTitle はチャンネル名から動的生成する', async () => {
    // Given
    interaction.channel.name = '日用品';

    // When
    await command.execute(context);

    // Then
    expect(initializationService.initializeInventory).toHaveBeenCalledWith({
      channelId: 'inventory-channel-1',
      listTitle: '日用品の在庫'
    });
  });
});
