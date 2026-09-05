import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../../src/utils/logger';
import { CommandError } from '../../src/utils/CommandError';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';
import { LinkInventoryCommand } from '../../src/commands/LinkInventoryCommand';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('LinkInventoryCommand', () => {
  let command: LinkInventoryCommand;
  let mockLogger: MockLogger;
  let mockRemindChannelStore: any;
  let mockInventoryChannelStore: any;
  let mockInteraction: any;
  let context: CommandExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = new MockLogger();
    mockRemindChannelStore = {
      updateChannelMetadata: vi.fn().mockResolvedValue({ success: true })
    };
    mockInventoryChannelStore = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: {
          channelId: 'inventory-channel-1',
          messageId: 'inventory-message-1',
          listTitle: '在庫リスト',
          lastSyncTime: new Date('2026-05-09T00:00:00.000Z')
        }
      })
    };
    mockInteraction = {
      options: {
        getChannel: vi.fn((name: string) => {
          if (name === 'inventory-channel') {
            return { id: 'inventory-channel-1', name: 'stock' };
          }
          return null;
        })
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn(),
      client: {} as any
    };
    context = {
      channelId: 'task-channel-1',
      interaction: mockInteraction as any
    };

    command = new LinkInventoryCommand(
      mockLogger as unknown as Logger,
      mockRemindChannelStore,
      mockInventoryChannelStore
    );
  });

  it('inventory-channel が指定され、対象が /init-inventory 済みなら updateChannelMetadata が呼ばれ成功応答する', async () => {
    // Given
    mockInteraction.options.getChannel.mockReturnValue({ id: 'inventory-channel-1', name: 'stock' });
    mockInventoryChannelStore.getChannelMetadata.mockResolvedValue({
      success: true,
      metadata: { channelId: 'inventory-channel-1' }
    });

    // When
    await command.execute(context);

    // Then
    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(mockInventoryChannelStore.getChannelMetadata).toHaveBeenCalledWith('inventory-channel-1');
    expect(mockRemindChannelStore.updateChannelMetadata).toHaveBeenCalledWith(
      'task-channel-1',
      { linkedInventoryChannelId: 'inventory-channel-1' }
    );
    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('在庫チャンネルをリンクしました')
    });
  });

  it('inventory-channel が指定されていない場合はエラー応答する', async () => {
    // Given
    mockInteraction.options.getChannel.mockReturnValue(null);

    // When
    const actual = command.execute(context);

    // Then
    await expect(actual).rejects.toThrow(CommandError);
    await expect(actual).rejects.toMatchObject({
      userMessage: expect.stringContaining('inventory-channel')
    });
    expect(mockRemindChannelStore.updateChannelMetadata).not.toHaveBeenCalled();
  });

  it('対象 inventory-channel が未初期化なら /init-inventory の実行を案内してエラー応答する', async () => {
    // Given
    mockInteraction.options.getChannel.mockReturnValue({ id: 'inventory-channel-1', name: 'stock' });
    mockInventoryChannelStore.getChannelMetadata.mockResolvedValue({
      success: false,
      message: 'metadataが見つかりません'
    });

    // When
    const actual = command.execute(context);

    // Then
    await expect(actual).rejects.toThrow(CommandError);
    await expect(actual).rejects.toMatchObject({
      userMessage: expect.stringContaining('/init-inventory を実行してください')
    });
    expect(mockRemindChannelStore.updateChannelMetadata).not.toHaveBeenCalled();
  });

  it('updateChannelMetadata 失敗時はエラー応答する', async () => {
    // Given
    mockInteraction.options.getChannel.mockReturnValue({ id: 'inventory-channel-1', name: 'stock' });
    mockInventoryChannelStore.getChannelMetadata.mockResolvedValue({
      success: true,
      metadata: { channelId: 'inventory-channel-1' }
    });
    mockRemindChannelStore.updateChannelMetadata.mockResolvedValue({
      success: false,
      message: 'metadata更新に失敗しました'
    });

    // When
    const actual = command.execute(context);

    // Then
    await expect(actual).rejects.toThrow(CommandError);
    await expect(actual).rejects.toMatchObject({
      userMessage: expect.stringContaining('在庫チャンネルのリンクに失敗しました')
    });
  });
});
