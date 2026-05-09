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
      listTitle: 'stockの在庫',
      client: interaction.client
    });
    expect(interaction.deleteReply).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('InventoryInitializationService が失敗した場合は editReply でエラー応答する', async () => {
    // Given
    initializationService.initializeInventory.mockResolvedValue({
      success: false,
      message: 'シートの作成に失敗しました'
    });

    // When
    await command.execute(context);

    // Then
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(initializationService.initializeInventory).toHaveBeenCalledWith({
      channelId: 'inventory-channel-1',
      listTitle: 'stockの在庫',
      client: interaction.client
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('在庫管理の初期化に失敗しました')
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('シートの作成に失敗しました')
    });
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
      listTitle: '日用品の在庫',
      client: interaction.client
    });
  });
});
