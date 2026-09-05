import type { RemindTask } from '../models/RemindTask';
import type { RemindTaskRepository as TaskPort, StoredRemindTask, OperationResult, InventoryConsumption, DayBounds, RemindTaskPatch } from '../repositories/contracts';
import { PostgresRemindTaskRepository } from '../repositories/PostgresRemindTaskRepository';
import type { RemindInventoryEdit } from '../repositories/contracts';

const fromStored = (task: StoredRemindTask): RemindTask => ({ ...task,
  messageId: task.messageId ?? undefined, description: task.description ?? undefined,
  overdueNotifyLimit: task.overdueNotifyLimit ?? undefined });
const toStored = (channelId: string, task: RemindTask): StoredRemindTask => ({ ...task, channelId, position: 0,
  messageId: task.messageId ?? null, description: task.description ?? null,
  overdueNotifyLimit: task.overdueNotifyLimit ?? null });

export class RemindTaskRepository {
  constructor(private readonly repository: TaskPort = new PostgresRemindTaskRepository()) {}
  async fetchTasks(channelId: string): Promise<RemindTask[]> { return (await this.repository.fetchTasks(channelId)).map(fromStored); }
  async findTaskByMessageId(channelId: string, messageId: string): Promise<RemindTask | null> {
    const task = await this.repository.findTaskByMessageId(channelId, messageId); return task ? fromStored(task) : null;
  }
  async appendTask(channelId: string, task: RemindTask): Promise<OperationResult> {
    await this.repository.appendTask(channelId, toStored(channelId, task)); return { success: true };
  }
  async patchTask(channelId: string, task: RemindTask, patch: RemindTaskPatch): Promise<OperationResult> {
    await this.repository.patchTask(channelId, task.id, task.revision, patch); return { success: true };
  }
  async editInventorySettings(channelId: string, task: RemindTask, items: RemindInventoryEdit[]): Promise<{ task: RemindTask; inventoryChannelId: string | null; stockChanged: boolean }> {
    const result = await this.repository.editInventorySettings(channelId, task.id, task.revision, items);
    return { ...result, task: fromStored(result.task) };
  }
  async deleteTask(channelId: string, taskId: string): Promise<OperationResult> {
    await this.repository.deleteTask(channelId, taskId); return { success: true };
  }
  async complete(channelId: string, task: RemindTask, now: Date, nextDueAt: Date, consumption?: InventoryConsumption[]): Promise<void> {
    await this.repository.complete(channelId, task.id, task.revision, now, nextDueAt, consumption);
  }
  async markNotified(channelId: string, task: RemindTask, kind: 'before' | 'overdue', now: Date): Promise<boolean> {
    return this.repository.markNotified(toStored(channelId, task), kind, now);
  }
  async notificationCandidates(channelId: string, now: Date, day: DayBounds): Promise<RemindTask[]> {
    return (await this.repository.notificationCandidates(channelId, now, day)).map(fromStored);
  }
  async activeTasks(channelId: string): Promise<RemindTask[]> { return (await this.repository.activeTasks(channelId)).map(fromStored); }
  async referencingInventory(channelId: string, inventoryId: string): Promise<(RemindTask & { channelId: string })[]> {
    return (await this.repository.referencingInventory(channelId, inventoryId)).map(task => ({ ...fromStored(task), channelId: task.channelId }));
  }
}
