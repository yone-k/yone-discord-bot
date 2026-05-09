import { AutocompleteInteraction } from 'discord.js';

export abstract class BaseAutocompleteHandler {
  public abstract commandName: string;
  public abstract focusedOptionName: string;

  public abstract handle(interaction: AutocompleteInteraction): Promise<void>;
}
