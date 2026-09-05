export interface OperationResult { success: boolean; message?: string }
export type Decimal = string;
export interface ChannelSettings {
  channelId: string; messageId: string | null; listTitle: string; operationLogThreadId: string | null;
}
export interface ListChannel extends ChannelSettings { defaultCategory: string; editVersion: string }
export interface InventoryChannel extends ChannelSettings { defaultCategory: string }
export interface RemindChannel extends ChannelSettings {
  remindNoticeThreadId: string | null; remindNoticeMessageId: string | null; linkedInventoryChannelId: string | null;
}
export interface StoredListItem {
  id: string; channelId: string; name: string; category: string | null; until: string | null;
  isCompleted: boolean; lastNotifiedAt: Date | null; position: number;
}
export type ListEditItem = Pick<StoredListItem, 'name' | 'category' | 'until' | 'isCompleted'>;
export interface ListSnapshot { items: StoredListItem[]; editVersion: string }
export interface StoredInventoryItem {
  channelId: string; id: string; name: string; stock: Decimal; category: string | null; position: number;
}
export interface InventoryConsumption { inventoryId: string; consume: Decimal }
export interface StoredRemindTask {
  channelId: string; id: string; messageId: string | null; title: string; description: string | null;
  intervalDays: number; timeOfDay: string; remindBeforeMinutes: number; startAt: Date; nextDueAt: Date;
  lastDoneAt: Date | null; lastRemindDueAt: Date | null; overdueNotifyCount: number;
  overdueNotifyLimit: number | null; lastOverdueNotifiedAt: Date | null; isPaused: boolean;
  createdAt: Date; updatedAt: Date; revision: string; position: number; inventoryItems: InventoryConsumption[];
}
export type NewRemindTask = Omit<StoredRemindTask, 'channelId' | 'revision' | 'position'>;
export type RemindTaskPatch = Partial<Omit<NewRemindTask, 'id' | 'createdAt' | 'updatedAt'>>;
export interface DayBounds { date: string; start: Date; end: Date }
export interface ListRepository {
  fetchAll(channelId: string): Promise<StoredListItem[]>;
  snapshot(channelId: string): Promise<ListSnapshot>;
  save(channelId: string, expectedVersion: string, items: ListEditItem[]): Promise<void>;
  append(channelId: string, item: ListEditItem): Promise<StoredListItem>;
  update(channelId: string, id: string, item: ListEditItem): Promise<void>;
  delete(channelId: string, id: string): Promise<void>;
  reorder(channelId: string, ids: string[]): Promise<void>;
  notificationCandidates(day: DayBounds): Promise<StoredListItem[]>;
  markNotified(id: string, until: string, notifiedAt: Date): Promise<boolean>;
}
export interface ListChannelRepository {
  get(channelId: string): Promise<ListChannel | null>; list(): Promise<ListChannel[]>;
  save(channel: Omit<ListChannel, 'editVersion'>): Promise<void>;
  patch(channelId: string, changes: Partial<Omit<ListChannel, 'channelId' | 'editVersion'>>): Promise<void>;
  setMessageId(channelId: string, messageId: string | null): Promise<void>;
  delete(channelId: string): Promise<void>;
}
export interface InventoryChannelRepository {
  get(channelId: string): Promise<InventoryChannel | null>; list(): Promise<InventoryChannel[]>;
  save(channel: InventoryChannel): Promise<void>; delete(channelId: string): Promise<void>;
  patch(channelId: string, changes: Partial<Omit<InventoryChannel, 'channelId'>>): Promise<void>;
}
export interface RemindChannelRepository {
  get(channelId: string): Promise<RemindChannel | null>; list(): Promise<RemindChannel[]>;
  save(channel: RemindChannel): Promise<void>; delete(channelId: string): Promise<void>;
  patch(channelId: string, changes: Partial<Omit<RemindChannel, 'channelId'>>): Promise<void>;
  linkedTo(inventoryChannelId: string): Promise<RemindChannel[]>;
}
export interface InventoryRepository {
  apply(channelId: string, expected: Omit<StoredInventoryItem, 'channelId' | 'position'>[], items: Omit<StoredInventoryItem, 'channelId' | 'position'>[]): Promise<void>;
  fetchAll(channelId: string): Promise<StoredInventoryItem[]>;
  findById(channelId: string, id: string): Promise<StoredInventoryItem | null>;
  findByName(channelId: string, name: string): Promise<StoredInventoryItem | null>;
  append(channelId: string, item: Omit<StoredInventoryItem, 'channelId' | 'position'>): Promise<void>;
  update(channelId: string, item: Omit<StoredInventoryItem, 'channelId' | 'position'>): Promise<void>;
  bulkUpdate(channelId: string, items: Omit<StoredInventoryItem, 'channelId' | 'position'>[]): Promise<void>;
  delete(channelId: string, id: string): Promise<void>;
  reorder(channelId: string, ids: string[]): Promise<void>;
}
export interface RemindInventoryEdit { name: string; stock?: Decimal; consume: Decimal }
export interface RemindInventoryEditResult { task: StoredRemindTask; inventoryChannelId: string | null; stockChanged: boolean }
export interface RemindTaskRepository {
  fetchTasks(channelId: string): Promise<StoredRemindTask[]>;
  findTaskByMessageId(channelId: string, messageId: string): Promise<StoredRemindTask | null>;
  appendTask(channelId: string, task: NewRemindTask): Promise<void>;
  patchTask(channelId: string, id: string, expectedRevision: string, patch: RemindTaskPatch): Promise<void>;
  editInventorySettings(channelId: string, id: string, expectedRevision: string, items: RemindInventoryEdit[]): Promise<RemindInventoryEditResult>;
  deleteTask(channelId: string, taskId: string): Promise<void>;
  reorder(channelId: string, ids: string[]): Promise<void>;
  referencingInventory(channelId: string, inventoryId: string): Promise<StoredRemindTask[]>;
  notificationCandidates(channelId: string, now: Date, day: DayBounds): Promise<StoredRemindTask[]>;
  activeTasks(channelId: string): Promise<StoredRemindTask[]>;
  markNotified(task: StoredRemindTask, kind: 'before' | 'overdue', now: Date): Promise<boolean>;
  complete(channelId: string, id: string, revision: string, completedAt: Date, nextDueAt: Date,
    consumption?: InventoryConsumption[]): Promise<void>;
}
export class RepositoryError extends Error {
  constructor(public readonly code: 'conflict' | 'not_found' | 'shortage' | 'invalid_input' | 'referenced', message: string) {
    super(message); this.name = 'RepositoryError';
  }
}
