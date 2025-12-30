import { Client } from 'discord.js';
import { createRemindTask, RemindTask } from '../models/RemindTask';
import { calculateNextDueAt, calculateStartAt, normalizeTimeOfDay } from '../utils/RemindSchedule';
import { RemindSheetManager } from './RemindSheetManager';
import { RemindTaskRepository } from './RemindTaskRepository';
import { RemindMetadataManager } from './RemindMetadataManager';
import { RemindMessageManager } from './RemindMessageManager';

export interface RemindTaskInputData {
  title: string;
  description?: string;
  intervalDays: number;
  timeOfDay?: string;
  remindBeforeMinutes?: number;
}

export interface RemindTaskServiceResult {
  success: boolean;
  task?: RemindTask;
  messageId?: string;
  message?: string;
}

export class RemindTaskService {
  constructor(
    private sheetManager: RemindSheetManager = new RemindSheetManager(),
    private repository: RemindTaskRepository = new RemindTaskRepository(),
    private metadataManager: RemindMetadataManager = RemindMetadataManager.getInstance(),
    private messageManager: RemindMessageManager = new RemindMessageManager(),
    private idGenerator: () => string = () => `task-${Date.now()}`
  ) {}

  public async addTask(
    channelId: string,
    input: RemindTaskInputData,
    client: Client,
    now: Date = new Date(),
    listTitle: string = 'リマインドリスト'
  ): Promise<RemindTaskServiceResult> {
    await this.sheetManager.getOrCreateChannelSheet(channelId);

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
    const updateResult = await this.repository.updateTask(channelId, updatedTask);
    if (!updateResult.success) {
      return { success: false, message: updateResult.message };
    }

    const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
    if (!metadataResult.success) {
      await this.metadataManager.createChannelMetadata(
        channelId,
        '',
        listTitle,
        metadataResult.metadata?.operationLogThreadId,
        metadataResult.metadata?.remindNoticeThreadId,
        metadataResult.metadata?.remindNoticeMessageId
      );
    }

    return { success: true, task: updatedTask, messageId: messageResult.messageId };
  }
}
