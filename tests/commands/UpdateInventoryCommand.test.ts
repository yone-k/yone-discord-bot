import { SlashCommandBuilder } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';
import { UpdateInventoryCommand } from '../../src/commands/UpdateInventoryCommand';
import type { InventoryItem } from '../../src/models/InventoryItem';
import type { Logger } from '../../src/utils/logger';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('UpdateInventoryCommand', () => {
  let logger: MockLogger;
  let repository: {
    fetchAll: ReturnType<typeof vi.fn>;
  };
  let interaction: {
    options: {
      getString: ReturnType<typeof vi.fn>;
    };
    showModal: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
  };
  let context: CommandExecutionContext;
  let command: UpdateInventoryCommand;

  const detergent: InventoryItem = {
    id: 'inventory-1',
    name: '洗剤',
    stock: 3,
    category: '日用品'
  };

  beforeEach(() => {
    logger = new MockLogger();
    repository = {
      fetchAll: vi.fn()
    };
    interaction = {
      options: {
        getString: vi.fn().mockReturnValue('洗剤')
      },
      showModal: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined)
    };
    context = {
      channelId: 'inventory-channel-1',
      userId: 'user-1',
      interaction: interaction as any
    };
    command = new UpdateInventoryCommand(logger as unknown as Logger, repository as any);
  });

  it('全在庫を取得し、CSVを初期値にした更新モーダルを表示する', async () => {
    // Given
    repository.fetchAll.mockResolvedValue([detergent]);

    // When
    await command.execute(context);

    // Then
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();

    const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
    expect(modalJson.custom_id).toBe('inventory_update_modal');
    expect(modalJson.title).toContain('在庫');
    expect(findTextInput(modalJson, 'items')?.value).toBe('洗剤,3,日用品');
  });

  it('在庫0件でも空の更新モーダルを表示する', async () => {
    // Given
    repository.fetchAll.mockResolvedValue([]);

    // When
    await command.execute(context);

    // Then
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();

    const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
    expect(findTextInput(modalJson, 'items')?.value).toBe('');
  });

  it('コマンドオプションは持たない', () => {
    // Given
    const builder = new SlashCommandBuilder()
      .setName(UpdateInventoryCommand.getCommandName())
      .setDescription(UpdateInventoryCommand.getCommandDescription());

    // When
    const commandJson = UpdateInventoryCommand.getOptions(builder).toJSON();

    // Then
    expect(command.getName()).toBe('update-inventory');
    expect(command.getDescription()).toBe('在庫を更新する');
    expect(command.getEphemeral()).toBe(true);
    expect(commandJson.options).toEqual([]);
  });
});

function findTextInput(modalJson: any, customId: string): any | undefined {
  return modalJson.components
    .flatMap((row: any) => row.components)
    .find((component: any) => component.custom_id === customId);
}
