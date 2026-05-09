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
    findByName: ReturnType<typeof vi.fn>;
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
      findByName: vi.fn()
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

  it('name option で対象を取得し、既存値を初期値にした更新モーダルを表示する', async () => {
    // Given
    repository.findByName.mockResolvedValue(detergent);

    // When
    await command.execute(context);

    // Then
    expect(repository.findByName).toHaveBeenCalledWith('inventory-channel-1', '洗剤');
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();

    const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
    expect(modalJson.custom_id).toBe('inventory_update_modal_inventory-1');
    expect(modalJson.title).toContain('在庫');
    expect(findTextInput(modalJson, 'name')?.value).toBe('洗剤');
    expect(findTextInput(modalJson, 'stock')?.value).toBe('3');
    expect(findTextInput(modalJson, 'category')?.value).toBe('日用品');
  });

  it('対象が見つからない場合はエラー応答する', async () => {
    // Given
    repository.findByName.mockResolvedValue(null);

    // When
    await command.execute(context);

    // Then
    expect(repository.findByName).toHaveBeenCalledWith('inventory-channel-1', '洗剤');
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('アイテムが見つかりません'),
      flags: ['Ephemeral']
    });
  });

  it('name option は required かつ autocomplete 付きで定義する', () => {
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
    expect(commandJson.options).toContainEqual(expect.objectContaining({
      name: 'name',
      type: 3,
      required: true,
      autocomplete: true
    }));
  });
});

function findTextInput(modalJson: any, customId: string): any | undefined {
  return modalJson.components
    .flatMap((row: any) => row.components)
    .find((component: any) => component.custom_id === customId);
}
