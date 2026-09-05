import { describe, it, expect, vi } from 'vitest';
import { RemindTaskInventoryModalHandler } from '../../src/modals/RemindTaskInventoryModalHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

class Handler extends RemindTaskInventoryModalHandler { execute = this.executeAction.bind(this); }
function setup(input = '米,1.234,0.0123'): any {
  const task = createRemindTask({ id: 'task', revision: '7', messageId: '456', title: '料理', intervalDays: 1, timeOfDay: '09:00', startAt: new Date(), nextDueAt: new Date(), createdAt: new Date(), updatedAt: new Date(), inventoryItems: [{ inventoryId: 'rice', consume: '0.0123' }] });
  const repository = { findTaskByMessageId: vi.fn().mockResolvedValue(task), editInventorySettings: vi.fn().mockResolvedValue({ task: { ...task, revision: '8' }, inventoryChannelId: '2', stockChanged: false }) };
  const messages = { updateTaskMessage: vi.fn().mockResolvedValue({ success: true }) };
  const inventory = { fetchAll: vi.fn().mockResolvedValue([]) };
  const inventoryMessages = { createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true }) };
  const refresh = { refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined) };
  const handler = new Handler(new Logger(), undefined, undefined, repository as any, messages as any, inventory, inventoryMessages, refresh);
  const interaction = { customId: 'remind-task-inventory-modal:456:7', channelId: '3', client: {}, fields: { getTextInputValue: (): string => input } };
  return { task, repository, messages, inventoryMessages, refresh, handler, interaction };
}
describe('RemindTaskInventoryModalHandler', () => {
  it('sends all raw quantities together and renders the committed task', async () => {
    const x = setup();
    expect((await x.handler.execute({ interaction: x.interaction })).success).toBe(true);
    expect(x.repository.editInventorySettings).toHaveBeenCalledWith('3', x.task, [{ name: '米', stock: '1.234', consume: '0.0123' }]);
    expect(x.messages.updateTaskMessage).toHaveBeenCalledWith('3', '456', expect.objectContaining({ revision: '8' }), {}, expect.any(Date));
    expect(x.inventoryMessages.createOrUpdateMessage).not.toHaveBeenCalled();
  });
  it('does not call Discord while the transaction is pending or after failure', async () => {
    const x = setup();
    let reject!: (error: Error) => void;
    x.repository.editInventorySettings.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const result = x.handler.execute({ interaction: x.interaction });
    await vi.waitFor(() => expect(x.repository.editInventorySettings).toHaveBeenCalled());
    expect(x.messages.updateTaskMessage).not.toHaveBeenCalled();
    expect(x.inventoryMessages.createOrUpdateMessage).not.toHaveBeenCalled();
    reject(new Error('conflict'));
    expect((await result).success).toBe(false);
    expect(x.messages.updateTaskMessage).not.toHaveBeenCalled();
  });
  it('refreshes inventory and referencing tasks only after stock changes commit', async () => {
    const x = setup('米,5,0\n新規,1');
    x.repository.editInventorySettings.mockResolvedValue({ task: x.task, inventoryChannelId: '2', stockChanged: true });
    expect((await x.handler.execute({ interaction: x.interaction })).success).toBe(true);
    expect(x.repository.editInventorySettings).toHaveBeenCalledWith('3', x.task, [{ name: '米', stock: '5', consume: '0' }, { name: '新規', stock: undefined, consume: '1' }]);
    expect(x.inventoryMessages.createOrUpdateMessage).toHaveBeenCalled();
    expect(x.refresh.refreshTasksUsingInventory).toHaveBeenCalledWith('2', {}, { excludeMessageId: '456' });
  });
  it('clears consumption atomically for empty input', async () => {
    const x = setup('');
    expect((await x.handler.execute({ interaction: x.interaction })).success).toBe(true);
    expect(x.repository.editInventorySettings).toHaveBeenCalledWith('3', x.task, []);
  });
  it('rejects stale modal before invoking persistence', async () => {
    const x = setup(); x.interaction.customId = 'remind-task-inventory-modal:456:6';
    expect((await x.handler.execute({ interaction: x.interaction })).success).toBe(false);
    expect(x.repository.editInventorySettings).not.toHaveBeenCalled();
  });
});
