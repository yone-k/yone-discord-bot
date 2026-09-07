import { CoreClient, coreClient, CoreApiError } from './CoreClient';
import type { Schema, StoredRemindTask, StoredListItem, ListSnapshot, ListEditItem, ListChannel, InventoryChannel, RemindChannel } from './contracts';

import { encodePathId as part } from './PathId';
const route = (resource: string, channelId: string): string => `/v1/${resource}/${part(channelId)}`;
export const hydrateListItem = (item: Schema['StoredListItem']): StoredListItem => ({ ...item, lastNotifiedAt: item.lastNotifiedAt === null ? null : new Date(item.lastNotifiedAt) });
export const hydrateTask = (task: Schema['StoredRemindTask']): StoredRemindTask => ({ ...task,
  startAt: new Date(task.startAt), nextDueAt: new Date(task.nextDueAt), createdAt: new Date(task.createdAt), updatedAt: new Date(task.updatedAt),
  lastDoneAt: task.lastDoneAt === null ? null : new Date(task.lastDoneAt),
  lastRemindDueAt: task.lastRemindDueAt === null ? null : new Date(task.lastRemindDueAt),
  lastOverdueNotifiedAt: task.lastOverdueNotifiedAt === null ? null : new Date(task.lastOverdueNotifiedAt)
});
async function nullable<T>(operation: () => Promise<T>): Promise<T | null> {
  try { return await operation(); } catch (error) { if (error instanceof CoreApiError && error.code === 'not_found') return null; throw error; }
}
class Adapter {
  constructor(private readonly providedClient?: CoreClient) {}
  protected get client(): CoreClient { return this.providedClient ?? coreClient(); }
}
export class ApiListChannelRepository extends Adapter {
  get(channelId: string): Promise<ListChannel | null> { return nullable(() => this.client.request('GET', route('lists', channelId))); }
  list(): Promise<ListChannel[]> { return this.client.request('GET', '/v1/lists'); }
  async save(channel: Schema['ListChannelInput']): Promise<void> { await this.client.request('PUT', route('lists', channel.channelId), channel); }
  async patch(channelId: string, changes: Schema['ListChannelPatch']): Promise<void> { await this.client.request('PATCH', route('lists', channelId), changes); }
  async delete(channelId: string): Promise<void> { await this.client.request('DELETE', route('lists', channelId)); }
}
export class ApiInventoryChannelRepository extends Adapter {
  get(channelId: string): Promise<InventoryChannel | null> { return nullable(() => this.client.request('GET', route('inventories', channelId))); }
  list(): Promise<InventoryChannel[]> { return this.client.request('GET', '/v1/inventories'); }
  async save(channel: Schema['InventoryChannelInput']): Promise<void> { await this.client.request('PUT', route('inventories', channel.channelId), channel); }
  async patch(channelId: string, changes: Schema['InventoryChannelPatch']): Promise<void> { await this.client.request('PATCH', route('inventories', channelId), changes); }
  async delete(channelId: string): Promise<void> { await this.client.request('DELETE', route('inventories', channelId)); }
}
export class ApiRemindChannelRepository extends Adapter {
  get(channelId: string): Promise<RemindChannel | null> { return nullable(() => this.client.request('GET', route('reminders', channelId))); }
  list(): Promise<RemindChannel[]> { return this.client.request('GET', '/v1/reminders'); }
  async save(channel: Schema['RemindChannelInput']): Promise<void> { await this.client.request('PUT', route('reminders', channel.channelId), channel); }
  async patch(channelId: string, changes: Schema['RemindChannelPatch']): Promise<void> { await this.client.request('PATCH', route('reminders', channelId), changes); }
  async delete(channelId: string): Promise<void> { await this.client.request('DELETE', route('reminders', channelId)); }
  linkedTo(channelId: string): Promise<RemindChannel[]> { return this.client.request('GET', `${route('inventories', channelId)}/linked-reminders`); }
  async linkInventory(channelId: string, inventoryChannelId: string | null): Promise<void> { await this.client.request('PUT', `${route('reminders', channelId)}/inventory-link`, { inventoryChannelId } satisfies Schema['LinkInventoryInput']); }
}
export class ApiListRepository extends Adapter {
  async fetchAll(channelId: string): Promise<StoredListItem[]> { return (await this.client.request<Schema['StoredListItem'][]>('GET', `${route('lists', channelId)}/items`)).map(hydrateListItem); }
  async snapshot(channelId: string): Promise<ListSnapshot> {
    const snapshot = await this.client.request<Schema['ListSnapshot']>('GET', `${route('lists', channelId)}/snapshot`);
    return { ...snapshot, items: snapshot.items.map(hydrateListItem) };
  }
  async save(channelId: string, expectedVersion: string, items: ListEditItem[]): Promise<void> { await this.client.request('POST', `${route('lists', channelId)}/save`, { expectedVersion, items } satisfies Schema['SaveListInput']); }
  async append(channelId: string, item: ListEditItem): Promise<StoredListItem> { return hydrateListItem(await this.client.request('POST', `${route('lists', channelId)}/items`, item)); }
  async update(channelId: string, id: string, item: ListEditItem): Promise<void> { await this.client.request('PUT', `${route('lists', channelId)}/items/${part(id)}`, item); }
  async delete(channelId: string, id: string): Promise<void> { await this.client.request('DELETE', `${route('lists', channelId)}/items/${part(id)}`); }
  async reorder(channelId: string, ids: string[]): Promise<void> { await this.client.request('POST', `${route('lists', channelId)}/reorder`, { ids } satisfies Schema['ReorderInput']); }
}
export class ApiInventoryRepository extends Adapter {
  async appendMany(channelId: string, items: Schema['InventoryItemInput'][]): Promise<string[]> {
    const result = await this.client.request<Schema['AppendInventoryItemsResult']>('POST', `${route('inventories', channelId)}/items/batch`, { items } satisfies Schema['AppendInventoryItemsInput']);
    return result.skippedNames;
  }
  fetchAll(channelId: string): Promise<Schema['StoredInventoryItem'][]> { return this.client.request('GET', `${route('inventories', channelId)}/items`); }
  findById(channelId: string, id: string): Promise<Schema['StoredInventoryItem'] | null> { return nullable(() => this.client.request('GET', `${route('inventories', channelId)}/items/${part(id)}`)); }
  findByName(channelId: string, name: string): Promise<Schema['StoredInventoryItem'] | null> { return nullable(() => this.client.request('GET', `${route('inventories', channelId)}/by-name?${new URLSearchParams({ name })}`)); }
  async append(channelId: string, item: Schema['InventoryItemInput']): Promise<void> { const { name, stock, category } = item; await this.client.request('POST', `${route('inventories', channelId)}/items`, { name, stock, category } satisfies Schema['InventoryItemInput']); }
  async update(channelId: string, item: Schema['InventoryEditItem']): Promise<void> { const { name, stock, category } = item; await this.client.request('PUT', `${route('inventories', channelId)}/items/${part(item.id)}`, { name, stock, category } satisfies Schema['InventoryItemInput']); }
  async bulkUpdate(channelId: string, items: Schema['InventoryEditItem'][]): Promise<void> { await this.client.request('POST', `${route('inventories', channelId)}/bulk`, { items } satisfies Schema['BulkInventoryInput']); }
  async apply(channelId: string, expected: Schema['InventoryEditItem'][], items: Schema['InventoryEditItem'][]): Promise<void> { await this.client.request('POST', `${route('inventories', channelId)}/apply`, { expected, items: items.map(({ id, ...item }) => id ? { id, ...item } : item) } satisfies Schema['ApplyInventoryInput']); }
  async delete(channelId: string, id: string): Promise<void> { await this.client.request('DELETE', `${route('inventories', channelId)}/items/${part(id)}`); }
  async reorder(channelId: string, ids: string[]): Promise<void> { await this.client.request('POST', `${route('inventories', channelId)}/reorder`, { ids } satisfies Schema['ReorderInput']); }
  resolveByName(channelId: string, name: string): Promise<Schema['StoredInventoryItem']> { return this.client.request('POST', `${route('inventories', channelId)}/resolve`, { name } satisfies Schema['ResolveInventoryInput']); }
}
export class ApiRemindTaskRepository extends Adapter {
  async fetchTasks(channelId: string): Promise<StoredRemindTask[]> { return (await this.client.request<Schema['StoredRemindTask'][]>('GET', `${route('reminders', channelId)}/tasks`)).map(hydrateTask); }
  findTaskByMessageId(channelId: string, messageId: string): Promise<StoredRemindTask | null> { return nullable(async () => hydrateTask(await this.client.request('GET', `${route('reminders', channelId)}/by-message?${new URLSearchParams({ messageId })}`))); }
  async appendTask(channelId: string, task: Schema['CreateTaskInput']): Promise<StoredRemindTask> { return hydrateTask(await this.client.request('POST', `${route('reminders', channelId)}/tasks`, task)); }
  async patchTask(channelId: string, id: string, expectedRevision: string, patch: Schema['TaskPatch']): Promise<StoredRemindTask> { return hydrateTask(await this.client.request('PATCH', `${route('reminders', channelId)}/tasks/${part(id)}`, { expectedRevision, patch } satisfies Schema['PatchTaskInput'])); }
  async editInventorySettings(channelId: string, id: string, expectedRevision: string, items: Schema['RemindInventoryEdit'][]): Promise<{ task: StoredRemindTask; inventoryChannelId: string | null; stockChanged: boolean }> {
    const result = await this.client.request<Schema['RemindInventoryEditResult']>('POST', `${route('reminders', channelId)}/tasks/${part(id)}/inventory-settings`, { expectedRevision, items } satisfies Schema['EditTaskInventoryInput']);
    return { ...result, task: hydrateTask(result.task) };
  }
  async deleteTask(channelId: string, id: string): Promise<void> { await this.client.request('DELETE', `${route('reminders', channelId)}/tasks/${part(id)}`); }
  async reorder(channelId: string, ids: string[]): Promise<void> { await this.client.request('POST', `${route('reminders', channelId)}/reorder`, { ids }); }
  async referencingInventory(channelId: string, id: string): Promise<StoredRemindTask[]> { return (await this.client.request<Schema['StoredRemindTask'][]>('GET', `${route('inventories', channelId)}/items/${part(id)}/references`)).map(hydrateTask); }
  async complete(channelId: string, id: string, expectedRevision: string, consumeOverrides?: Schema['ConsumptionOverride'][]): Promise<StoredRemindTask> { return hydrateTask(await this.client.request('POST', `${route('reminders', channelId)}/tasks/${part(id)}/complete`, { expectedRevision, consumeOverrides } satisfies Schema['CompleteTaskInput'])); }
  shortageCheck(channelId: string, id: string): Promise<Schema['ShortageResult']> { return this.client.request('GET', `${route('reminders', channelId)}/tasks/${part(id)}/shortage-check`); }
}
