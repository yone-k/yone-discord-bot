import { Client } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { createRemindTask, RemindTask } from '../models/RemindTask';
import { calculateNextDueAt, calculateStartAt, normalizeTimeOfDay } from '../utils/RemindSchedule';
import { RemindTaskRepository } from './RemindTaskRepository';
import { RemindChannelStore } from './RemindChannelStore';
import { RemindMessageManager } from './RemindMessageManager';

export interface RemindTaskInputData {
  title: string;
  description?: string;
  intervalDays: number;
  timeOfDay?: string;
  remindBeforeMinutes?: number;
  inventoryItems?: RemindTask['inventoryItems'];
}

export interface RemindTaskServiceResult {
  success: boolean;
  task?: RemindTask;
  messageId?: string;
  message?: string;
}

export class RemindTaskService {
  constructor(
    private repository: RemindTaskRepository = new RemindTaskRepository(),
    private metadataManager: RemindChannelStore = RemindChannelStore.getInstance(),
    private messageManager: RemindMessageManager = new RemindMessageManager(),
    private idGenerator: () => string = randomUUID
  ) {}

  public async addTask(
    channelId: string,
    input: RemindTaskInputData,
    client: Client,
    now: Date = new Date(),
    listTitle: string = 'リマインドリスト'
  ): Promise<RemindTaskServiceResult> {
    const metadata = await this.metadataManager.getChannelMetadata(channelId);
    if (!metadata.success) await this.metadataManager.createChannelMetadata(channelId, '', listTitle);

    const createdAt = now;
    const normalizedTimeOfDay = normalizeTimeOfDay(input.timeOfDay ?? '00:00');
    const startAt = calculateStartAt(createdAt, normalizedTimeOfDay);
    const nextDueAt = calculateNextDueAt(
      {
        intervalDays: input.intervalDays,
        timeOfDay: normalizedTimeOfDay,
        startAt
      },
      now
    );

    const task = createRemindTask({
      id: this.idGenerator(),
      title: input.title,
      description: input.description,
      intervalDays: input.intervalDays,
      timeOfDay: normalizedTimeOfDay,
      remindBeforeMinutes: input.remindBeforeMinutes ?? 1440,
      inventoryItems: input.inventoryItems ?? [],
      startAt,
      nextDueAt,
      createdAt,
      updatedAt: createdAt
    });

    const appendResult = await this.repository.appendTask(channelId, task);
    if (!appendResult.success) {
      return { success: false, message: appendResult.message };
    }

    const messageResult = await this.messageManager.createTaskMessage(channelId, task, client, now);
    if (!messageResult.success || !messageResult.messageId) {
      return { success: false, message: messageResult.message };
    }

    const updatedTask = {
      ...task,
      messageId: messageResult.messageId,
      updatedAt: new Date()
    };
    const updateResult = await this.repository.patchTask(channelId, task, { messageId: messageResult.messageId });
    if (!updateResult.success) {
      return { success: false, message: updateResult.message };
    }

    return { success: true, task: { ...updatedTask, revision: '1' }, messageId: messageResult.messageId };
  }
}
