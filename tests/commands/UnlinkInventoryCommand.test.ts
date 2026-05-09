import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../../src/utils/logger';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';
import { UnlinkInventoryCommand } from '../../src/commands/UnlinkInventoryCommand';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('UnlinkInventoryCommand', () => {
  let command: UnlinkInventoryCommand;
  let mockLogger: MockLogger;
  let mockRemindMetadataManager: any;
  let mockInteraction: any;
  let context: CommandExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = new MockLogger();
    mockRemindMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: {
          channelId: 'task-channel-1',
          messageId: 'message-1',
          listTitle: 'タスクリスト',
          lastSyncTime: new Date('2026-05-09T00:00:00.000Z'),
          linkedInventoryChannelId: 'inventory-channel-1'
        }
      }),
      updateChannelMetadata: vi.fn().mockResolvedValue({ success: true })
    };
    mockInteraction = {
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn(),
      client: {} as any
    };
    context = {
      channelId: 'task-channel-1',
      interaction: mockInteraction as any
    };

    command = new UnlinkInventoryCommand(
      mockLogger as unknown as Logger,
      mockRemindMetadataManager
    );
  });

  it('自チャンネルの linkedInventoryChannelId が設定されていれば clear する updateChannelMetadata を呼び出す', async () => {
    // Given
    mockRemindMetadataManager.getChannelMetadata.mockResolvedValue({
      success: true,
      metadata: { channelId: 'task-channel-1', linkedInventoryChannelId: 'inventory-channel-1' }
    });

    // When
    await command.execute(context);

    // Then
    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(mockRemindMetadataManager.getChannelMetadata).toHaveBeenCalledWith('task-channel-1');
    expect(mockRemindMetadataManager.updateChannelMetadata).toHaveBeenCalledWith(
      'task-channel-1',
      { linkedInventoryChannelId: undefined }
    );
    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('在庫チャンネルのリンクを解除しました')
    });
  });

  it('linkedInventoryChannelId が未設定なら no-op で成功応答する', async () => {
    // Given
    mockRemindMetadataManager.getChannelMetadata.mockResolvedValue({
      success: true,
      metadata: { channelId: 'task-channel-1', linkedInventoryChannelId: undefined }
    });

    // When
    await command.execute(context);

    // Then
    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(mockRemindMetadataManager.getChannelMetadata).toHaveBeenCalledWith('task-channel-1');
    expect(mockRemindMetadataManager.updateChannelMetadata).not.toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('リンクされている在庫チャンネルはありません')
    });
  });
});
