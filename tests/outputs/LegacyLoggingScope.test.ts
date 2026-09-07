import { afterEach, expect, it, vi } from 'vitest';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { ButtonManager } from '../../src/services/ButtonManager';
import { ModalManager } from '../../src/services/ModalManager';
import { registerAllButtons } from '../../src/registry/RegisterButtons';
import { registerAllModals } from '../../src/registry/RegisterModals';
import { UiOperationEvents } from '../../src/services/UiOperationEvents';
import { ListChannelStore } from '../../src/services/ListChannelStore';
import { Logger, LogLevel } from '../../src/utils/logger';
import type { OperationResult } from '../../src/models/types/OperationLog';

afterEach(() => vi.restoreAllMocks());

it('preserves the nine UI event paths through actual registry and base-handler wiring', async () => {
  const logger = new Logger(LogLevel.ERROR);
  const log = vi.spyOn(UiOperationEvents.prototype, 'record').mockResolvedValue();
  const store = ListChannelStore.getInstance();
  const buttons = new ButtonManager(logger);
  const modals = new ModalManager(logger);
  registerAllButtons(buttons, logger, new UiOperationEvents(logger), store);
  registerAllModals(modals, logger);
  const reported: string[] = [];
  const skipped: string[] = [];
  for (const handler of [...buttons.getRegisteredHandlers(), ...modals.getRegisteredHandlers()]) {
    // This checks UI event routing. UiEventBoundary and Go integration tests
    // cover suppression after business writes and actual output reservations.
    const action = vi.spyOn(handler as unknown as { executeAction(): Promise<OperationResult> }, 'executeAction').mockResolvedValue({ success: true });
    log.mockClear();
    const requiresTarget = ['remind-task-update-cancel', 'remind-task-update-modal', 'remind-task-update-override-modal', 'remind-task-inventory-modal', 'remind-task-complete-modal', 'remind-task-delete-modal', 'inventory_delete_modal'];
    const baseId = handler.getCustomId();
    const interaction = {
      customId: requiresTarget.includes(baseId) ? `${baseId}:message:1` : baseId, user: { id: 'actor', bot: false },
      guild: { id: 'guild' }, guildId: 'guild', channel: { id: 'channel' }, channelId: 'channel',
      client: {}, createdTimestamp: Date.now(), deferred: false, replied: false,
      deferReply: vi.fn(), editReply: vi.fn(), deleteReply: vi.fn(), reply: vi.fn(),
      fetchReply: vi.fn().mockResolvedValue({ delete: vi.fn() })
    };
    await handler.handle({ interaction: interaction as unknown as ButtonInteraction & ModalSubmitInteraction });
    expect(action, handler.constructor.name).toHaveBeenCalledOnce();
    expect(log.mock.calls.length, handler.constructor.name).toBeLessThanOrEqual(1);
    (log.mock.calls.length ? reported : skipped).push(handler.constructor.name);
  }
  expect(reported.sort()).toEqual([
    'InitListButtonHandler', 'AddListModalHandler', 'EditListModalHandler',
    'RemindTaskAddModalHandler', 'RemindTaskUpdateModalHandler',
    'RemindTaskUpdateOverrideModalHandler', 'RemindTaskInventoryModalHandler',
    'RemindTaskCompleteModalHandler', 'RemindTaskDeleteModalHandler'
  ].sort());
  expect(skipped.sort()).toEqual([
    'AddListButtonHandler', 'EditListButtonHandler', 'ConfirmationModalHandler',
    'RemindTaskUpdateButtonHandler', 'RemindTaskUpdateCancelButtonHandler',
    'RemindTaskCompleteButtonHandler', 'RemindTaskDeleteButtonHandler',
    'RemindTaskDetailButtonHandler', 'RemindTaskAddButtonHandler',
    'InventoryAddButtonHandler', 'InventoryUpdateButtonHandler', 'InventoryDeleteButtonHandler',
    'InventorySelectionCancelButtonHandler', 'InventoryAddModalHandler',
    'InventoryUpdateModalHandler', 'InventoryDeleteModalHandler'
  ].sort());
});
