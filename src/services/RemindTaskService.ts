import { RemindTask } from '../models/RemindTask';
import { normalizeTimeOfDay } from '../utils/RemindSchedule';
import { RemindTaskRepository } from './RemindTaskRepository';
import { RemindChannelStore } from './RemindChannelStore';

export interface RemindTaskInputData {
  title: string;
  description?: string;
  intervalDays: number;
  timeOfDay?: string;
  remindBeforeMinutes?: number;
  inventoryItems?: RemindTask['inventoryItems'];
}
export interface RemindTaskServiceResult {
  success: true;
  task: RemindTask;
}

export class RemindTaskService {
  constructor(
    private repository = new RemindTaskRepository(),
    private metadataManager = RemindChannelStore.getInstance()
  ) {}
  async addTask(channelId: string, input: RemindTaskInputData, listTitle = 'リマインドリスト'): Promise<RemindTaskServiceResult> {
    const metadata = await this.metadataManager.getChannelMetadata(channelId);
    if (!metadata.success) await this.metadataManager.createChannelMetadata(channelId, listTitle);
    const task = await this.repository.appendTask(channelId, {
      title: input.title, description: input.description ?? null, intervalDays: input.intervalDays,
      timeOfDay: normalizeTimeOfDay(input.timeOfDay ?? '00:00'), remindBeforeMinutes: input.remindBeforeMinutes ?? 1440,
      inventoryItems: input.inventoryItems ?? []
    });
    return { success: true, task };
  }
}
