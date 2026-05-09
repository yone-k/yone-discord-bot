import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../../src/utils/logger';
import { AddRemindListCommand } from '../../src/commands/AddRemindListCommand';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('AddRemindListCommand', () => {
  let command: AddRemindListCommand;
  let mockLogger: MockLogger;
  let mockContext: CommandExecutionContext;
  let mockService: any;
  let mockMetadataManager: any;
  let mockInventoryService: any;

  beforeEach(() => {
    mockLogger = new MockLogger();
    mockService = {
      addTask: vi.fn().mockResolvedValue({ success: true })
    };
    mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { linkedInventoryChannelId: 'inventory-channel-1' }
      })
    };
    mockInventoryService = {
      resolveByName: vi.fn().mockResolvedValue({
        id: 'inventory-1',
        name: 'フィルター',
        stock: 0,
        category: ''
      })
    };

    command = new (AddRemindListCommand as any)(
      mockLogger as unknown as Logger,
      mockService,
      mockMetadataManager,
      mockInventoryService
    );

    mockContext = {
      userId: 'user-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      interaction: {
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'title') return '掃除';
            if (name === 'time-of-day') return '09:00';
            if (name === 'description') return '週次';
            if (name === 'remind-before') return '1:00';
            if (name === 'inventory-items') return 'フィルター,1';
            return null;
          }),
          getInteger: vi.fn((name: string) => {
            if (name === 'interval-days') return 7;
            return null;
          })
        },
        reply: vi.fn(),
        deferReply: vi.fn(),
        deleteReply: vi.fn(),
        client: {} as any
      } as any
    };
  });

  it('executes add task flow with linked inventory items', async () => {
    await command.execute(mockContext);

    expect(mockMetadataManager.getChannelMetadata).toHaveBeenCalledWith('channel-1');
    expect(mockInventoryService.resolveByName).toHaveBeenCalledWith('inventory-channel-1', 'フィルター');
    expect(mockService.addTask).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'inventory-1', consume: 1 }]
      }),
      expect.anything()
    );
    expect(mockContext.interaction?.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(mockContext.interaction?.deleteReply).toHaveBeenCalled();
    expect(mockContext.interaction?.reply).not.toHaveBeenCalled();
  });

  it('responds with an error when inventory items are provided without linked inventory channel', async () => {
    mockMetadataManager.getChannelMetadata.mockResolvedValue({
      success: true,
      metadata: { linkedInventoryChannelId: undefined }
    });

    await expect(command.execute(mockContext)).rejects.toThrow(/在庫.*連携|linked inventory/i);

    expect(mockInventoryService.resolveByName).not.toHaveBeenCalled();
    expect(mockService.addTask).not.toHaveBeenCalled();
  });
});
