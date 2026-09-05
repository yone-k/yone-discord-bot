import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteInventoryCommand } from '../../src/commands/DeleteInventoryCommand';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';
import { Logger } from '../../src/utils/logger';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('DeleteInventoryCommand', () => {
  let command: DeleteInventoryCommand;
  let mockLogger: MockLogger;
  let mockRepository: {
    findByName: ReturnType<typeof vi.fn>;
  };
  let mockInteraction: any;
  let context: CommandExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = new MockLogger();
    mockRepository = {
      findByName: vi.fn()
    };
    mockInteraction = {
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'name') {
            return 'フィルター';
          }
          return null;
        })
      },
      showModal: vi.fn(),
      reply: vi.fn(),
      client: {} as any
    };
    context = {
      userId: 'user-1',
      guildId: 'guild-1',
      channelId: 'inventory-channel-1',
      interaction: mockInteraction
    };

    command = new DeleteInventoryCommand(
      mockLogger as unknown as Logger,
      mockRepository as any
    );
  });

  it('対象ありの場合、在庫IDを含む確認モーダルを表示する', async () => {
    // Given
    mockRepository.findByName.mockResolvedValue({
      id: 'inventory-item-1',
      name: 'フィルター',
      stock: '3',
      category: '消耗品'
    });

    // When
    await command.execute(context);

    // Then
    expect(mockRepository.findByName).toHaveBeenCalledWith('inventory-channel-1', 'フィルター');
    expect(mockInteraction.showModal).toHaveBeenCalledTimes(1);
    const modal = mockInteraction.showModal.mock.calls[0][0];
    expect(modal.data.custom_id).toBe('inventory_delete_modal_inventory-item-1');
    expect(modal.data.title).toContain('在庫削除');
    expect(mockInteraction.reply).not.toHaveBeenCalled();
  });

  it('対象不在の場合、エラー応答して確認モーダルを表示しない', async () => {
    // Given
    mockRepository.findByName.mockResolvedValue(null);

    // When
    await command.execute(context);

    // Then
    expect(mockRepository.findByName).toHaveBeenCalledWith('inventory-channel-1', 'フィルター');
    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('フィルター'),
      flags: ['Ephemeral']
    });
    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('見つかりません'),
      flags: ['Ephemeral']
    });
    expect(mockInteraction.showModal).not.toHaveBeenCalled();
  });
});
