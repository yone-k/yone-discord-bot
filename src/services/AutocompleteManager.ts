import { AutocompleteInteraction } from 'discord.js';
import { BaseAutocompleteHandler } from '../base/BaseAutocompleteHandler';

export class AutocompleteManager {
  private handlers: Map<string, BaseAutocompleteHandler> = new Map();

  public register(handler: BaseAutocompleteHandler): void {
    if (this.handlers.has(handler.commandName)) {
      throw new Error(`Autocomplete handler for commandName "${handler.commandName}" is already registered`);
    }

    this.handlers.set(handler.commandName, handler);
  }

  public async dispatch(interaction: AutocompleteInteraction): Promise<void> {
    const handler = this.handlers.get(interaction.commandName);

    if (!handler) {
      return;
    }

    await handler.handle(interaction);
  }
}
