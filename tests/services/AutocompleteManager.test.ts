import { AutocompleteInteraction } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseAutocompleteHandler } from '../../src/base/BaseAutocompleteHandler';
import { AutocompleteManager } from '../../src/services/AutocompleteManager';

class TestAutocompleteHandler extends BaseAutocompleteHandler {
  public readonly commandName: string;
  public readonly focusedOptionName: string;
  public readonly handle = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  constructor(commandName: string, focusedOptionName: string) {
    super();
    this.commandName = commandName;
    this.focusedOptionName = focusedOptionName;
  }
}

describe('AutocompleteManager', () => {
  let manager: AutocompleteManager;
  let matchingHandler: TestAutocompleteHandler;
  let otherHandler: TestAutocompleteHandler;
  let interaction: AutocompleteInteraction;

  beforeEach(() => {
    manager = new AutocompleteManager();
    matchingHandler = new TestAutocompleteHandler('remind', 'task');
    otherHandler = new TestAutocompleteHandler('list', 'name');
    interaction = {
      commandName: 'remind',
      options: {
        getFocused: vi.fn().mockReturnValue('sample')
      }
    } as unknown as AutocompleteInteraction;
  });

  describe('dispatch', () => {
    it('registerしたハンドラーが対応するcommandNameのautocomplete interactionで呼ばれる', async () => {
      // Given
      manager.register(matchingHandler);
      manager.register(otherHandler);

      // When
      await manager.dispatch(interaction);

      // Then
      expect(matchingHandler.handle).toHaveBeenCalledTimes(1);
      expect(matchingHandler.handle).toHaveBeenCalledWith(interaction);
      expect(otherHandler.handle).not.toHaveBeenCalled();
    });

    it('未登録のcommandNameが来たら何もせずhandleを呼ばない', async () => {
      // Given
      manager.register(matchingHandler);
      interaction = {
        ...interaction,
        commandName: 'unknown'
      } as AutocompleteInteraction;

      // When / Then
      await expect(manager.dispatch(interaction)).resolves.toBeUndefined();
      expect(matchingHandler.handle).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('同じcommandNameのハンドラーを複数登録するとエラーを投げる', () => {
      // Given
      const duplicateHandler = new TestAutocompleteHandler('remind', 'otherTask');
      manager.register(matchingHandler);

      // When / Then
      expect(() => manager.register(duplicateHandler)).toThrow(
        'Autocomplete handler for commandName "remind" is already registered'
      );
    });
  });
});
