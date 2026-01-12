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

  beforeEach(() => {
    mockLogger = new MockLogger();
    mockService = {
      addTask: vi.fn().mockResolvedValue({ success: true })
    };

    command = new AddRemindListCommand(mockLogger as unknown as Logger, mockService);

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
            if (name === 'inventory-items') return '牛乳,在庫3,消費1';
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

  it('executes add task flow', async () => {
    await command.execute(mockContext);

    expect(mockService.addTask).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        inventoryItems: [{ name: '牛乳', stock: 3, consume: 1 }]
      }),
      expect.anything()
    );
    expect(mockContext.interaction?.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(mockContext.interaction?.deleteReply).toHaveBeenCalled();
    expect(mockContext.interaction?.reply).not.toHaveBeenCalled();
  });
});
