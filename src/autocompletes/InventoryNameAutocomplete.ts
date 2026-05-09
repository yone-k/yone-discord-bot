import { AutocompleteInteraction } from 'discord.js';
import { BaseAutocompleteHandler } from '../base/BaseAutocompleteHandler';
import type { InventoryItem } from '../models/InventoryItem';
import { InventoryRepository } from '../services/InventoryRepository';

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

export class InventoryNameAutocomplete extends BaseAutocompleteHandler {
  public focusedOptionName = 'name';

  constructor(
    private readonly repository: InventoryRepositoryPort = new InventoryRepository(),
    public commandName = 'update-inventory'
  ) {
    super();
  }

  public async handle(interaction: AutocompleteInteraction): Promise<void> {
    if (!interaction.channelId) {
      await interaction.respond([]);
      return;
    }

    const focused = String(interaction.options.getFocused() ?? '');
    const items = await this.repository.fetchAll(interaction.channelId);
    const choices = items
      .filter(item => focused === '' || item.name.includes(focused))
      .slice(0, 25)
      .map(item => ({
        name: item.name,
        value: item.name
      }));

    await interaction.respond(choices);
  }
}
