import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../../src/utils/logger';
import { InitRemindListCommand } from '../../src/commands/InitRemindListCommand';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('InitRemindListCommand', () => {
  let command: InitRemindListCommand;
  let mockLogger: MockLogger;
  let mockService: any;

  beforeEach(() => {
    mockLogger = new MockLogger();
    mockService = {
      initialize: vi.fn().mockResolvedValue({ success: true })
    };
    command = new InitRemindListCommand(mockLogger as unknown as Logger, mockService);
  });

  it('initializes remind list', async () => {
    const context: CommandExecutionContext = {
      channelId: 'channel-1',
      interaction: {
        client: {} as any,
        channel: { name: 'general' },
        deferReply: vi.fn(),
        editReply: vi.fn()
      } as any
    };

    await command.execute(context);

    expect(mockService.initialize).toHaveBeenCalledWith('channel-1', context.interaction?.client, 'generalリマインド');
    expect(context.interaction?.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(context.interaction?.editReply).toHaveBeenCalledWith('✅ リマインドリストを同期しました。');
  });
});
