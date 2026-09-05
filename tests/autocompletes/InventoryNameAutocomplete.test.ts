import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryNameAutocomplete } from '../../src/autocompletes/InventoryNameAutocomplete';
import type { InventoryItem } from '../../src/models/InventoryItem';

describe('InventoryNameAutocomplete', () => {
  let repository: {
    fetchAll: ReturnType<typeof vi.fn>;
  };
  let interaction: {
    commandName: string;
    channelId: string;
    options: {
      getFocused: ReturnType<typeof vi.fn>;
      getFocusedName: ReturnType<typeof vi.fn>;
    };
    respond: ReturnType<typeof vi.fn>;
  };
  let autocomplete: InventoryNameAutocomplete;

  beforeEach(() => {
    repository = {
      fetchAll: vi.fn()
    };
    interaction = {
      commandName: 'update-inventory',
      channelId: 'inventory-channel-1',
      options: {
        getFocused: vi.fn(),
        getFocusedName: vi.fn().mockReturnValue('name')
      },
      respond: vi.fn().mockResolvedValue(undefined)
    };
    autocomplete = new InventoryNameAutocomplete(repository as any);
  });

  it('入力 \'洗\' に部分一致する候補を最大25件返す', async () => {
    // Given
    const items = [
      createItem('1', '洗剤'),
      createItem('2', '食器用洗剤'),
      createItem('3', '米')
    ];
    items.push(...Array.from({ length: 30 }, (_, index) => createItem(`extra-${index}`, `洗濯ネット${index}`)));
    repository.fetchAll.mockResolvedValue(items);
    interaction.options.getFocused.mockReturnValue('洗');

    // When
    await autocomplete.handle(interaction as any);

    // Then
    expect(autocomplete.commandName).toBe('update-inventory');
    expect(autocomplete.focusedOptionName).toBe('name');
    expect(repository.fetchAll).toHaveBeenCalledWith('inventory-channel-1');
    expect(interaction.respond).toHaveBeenCalledWith(
      expect.arrayContaining([
        { name: '洗剤', value: '洗剤' },
        { name: '食器用洗剤', value: '食器用洗剤' }
      ])
    );
    expect(interaction.respond.mock.calls[0][0]).toHaveLength(25);
    expect(interaction.respond.mock.calls[0][0]).not.toContainEqual({ name: '米', value: '米' });
  });

  it('候補が0件の場合は空配列を返す', async () => {
    // Given
    repository.fetchAll.mockResolvedValue([
      createItem('1', '米'),
      createItem('2', '味噌')
    ]);
    interaction.options.getFocused.mockReturnValue('洗');

    // When
    await autocomplete.handle(interaction as any);

    // Then
    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('入力が空の場合は全件を25件まで返す', async () => {
    // Given
    repository.fetchAll.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => createItem(`item-${index}`, `アイテム${index}`))
    );
    interaction.options.getFocused.mockReturnValue('');

    // When
    await autocomplete.handle(interaction as any);

    // Then
    expect(interaction.respond.mock.calls[0][0]).toHaveLength(25);
    expect(interaction.respond.mock.calls[0][0][0]).toEqual({ name: 'アイテム0', value: 'アイテム0' });
    expect(interaction.respond.mock.calls[0][0][24]).toEqual({ name: 'アイテム24', value: 'アイテム24' });
  });
});

function createItem(id: string, name: string): InventoryItem {
  return {
    id,
    name,
    stock: '1',
    category: '日用品'
  };
}
