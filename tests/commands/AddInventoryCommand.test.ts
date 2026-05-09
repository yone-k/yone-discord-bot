import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddInventoryCommand } from '../../src/commands/AddInventoryCommand';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';
import type { Logger } from '../../src/utils/logger';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('AddInventoryCommand', () => {
  let command: AddInventoryCommand;
  let logger: MockLogger;
  let context: CommandExecutionContext;

  beforeEach(() => {
    logger = new MockLogger();
    command = new AddInventoryCommand(logger as unknown as Logger);
    context = {
      userId: 'user-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      interaction: {
        showModal: vi.fn().mockResolvedValue(undefined)
      } as any
    };
  });

  it('Given a valid interaction When execute is called Then it shows inventory add modal', async () => {
    // Given
    const interaction = context.interaction as any;

    // When
    await command.execute(context);

    // Then
    expect(command.getName()).toBe('add-inventory');
    expect(command.getDescription()).toBe('在庫アイテムを追加する');
    expect((command as any).useThread).toBe(false);
    expect(command.getEphemeral()).toBe(true);
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          custom_id: 'inventory_add_modal'
        })
      })
    );
  });
});
