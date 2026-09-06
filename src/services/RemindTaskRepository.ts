import type { RemindTask } from '../models/RemindTask';
import type { RemindTaskRepository as TaskPort, StoredRemindTask, RemindTaskPatch, RemindInventoryEdit, Schema } from '../api/contracts';
import { ApiRemindTaskRepository } from '../api/Repositories';

export const fromStoredTask = (task: StoredRemindTask): RemindTask => ({ ...task,
  messageId: task.messageId ?? undefined, description: task.description ?? undefined,
  overdueNotifyLimit: task.overdueNotifyLimit ?? undefined });

export class RemindTaskRepository {
  constructor(private readonly repository: TaskPort = new ApiRemindTaskRepository()) {}
  async fetchTasks(channelId: string): Promise<RemindTask[]> { return (await this.repository.fetchTasks(channelId)).map(fromStoredTask); }
  async findTaskByMessageId(channelId: string, messageId: string): Promise<RemindTask | null> {
    const task = await this.repository.findTaskByMessageId(channelId, messageId); return task ? fromStoredTask(task) : null;
  }
  async appendTask(channelId: string, input: Schema['CreateTaskInput']): Promise<RemindTask> {
    return fromStoredTask(await this.repository.appendTask(channelId, input));
  }
  async patchTask(channelId: string, task: RemindTask, patch: RemindTaskPatch): Promise<{ success: true; task: RemindTask; message?: string }> {
    return { success: true, task: fromStoredTask(await this.repository.patchTask(channelId, task.id, task.revision, patch)) };
  }
  async editInventorySettings(channelId: string, task: RemindTask, items: RemindInventoryEdit[]): Promise<{ task: RemindTask; inventoryChannelId: string | null; stockChanged: boolean }> {
    const result = await this.repository.editInventorySettings(channelId, task.id, task.revision, items);
    return { ...result, task: fromStoredTask(result.task) };
  }
  async deleteTask(channelId: string, taskId: string): Promise<{ success: true; message?: string }> {
    await this.repository.deleteTask(channelId, taskId); return { success: true };
  }
  async complete(channelId: string, task: RemindTask, consumeOverrides?: Schema['ConsumptionOverride'][]): Promise<RemindTask> {
    return fromStoredTask(await this.repository.complete(channelId, task.id, task.revision, consumeOverrides));
  }
  async referencingInventory(channelId: string, inventoryId: string): Promise<(RemindTask & { channelId: string })[]> {
    return (await this.repository.referencingInventory(channelId, inventoryId)).map(task => ({ ...fromStoredTask(task), channelId: task.channelId }));
  }
  shortageCheck(channelId: string, taskId: string): Promise<Schema['ShortageResult']> { return this.repository.shortageCheck(channelId, taskId); }
}
