import { AutocompleteManager } from '../services/AutocompleteManager';
import { InventoryNameAutocomplete } from '../autocompletes/InventoryNameAutocomplete';
import { Logger } from '../utils/logger';

export function registerAllAutocompletes(autocompleteManager: AutocompleteManager, _logger: Logger): void {
  autocompleteManager.register(new InventoryNameAutocomplete());
  autocompleteManager.register(new InventoryNameAutocomplete(undefined, 'delete-inventory'));
}
