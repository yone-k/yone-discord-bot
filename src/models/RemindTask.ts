export interface NewRemindInventoryItem {
  inventoryId: string;
  consume: string;
}

export type RemindInventoryItem = NewRemindInventoryItem;

export interface RemindTask {
  id: string;
  revision: string;
  messageId?: string;
  title: string;
  description?: string;
  intervalDays: number;
  timeOfDay: string;
  remindBeforeMinutes: number;
  inventoryItems: RemindInventoryItem[];
  startAt: Date;
  nextDueAt: Date;
  lastDoneAt: Date | null;
  lastRemindDueAt: Date | null;
  overdueNotifyCount: number;
  overdueNotifyLimit?: number;
  lastOverdueNotifiedAt: Date | null;
  isPaused: boolean;
  createdAt: Date;
  updatedAt: Date;
}
