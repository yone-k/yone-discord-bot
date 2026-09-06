import { Client } from 'discord.js';
import { RemindTask } from '../models/RemindTask';
import { normalizeTimeOfDay } from '../utils/RemindSchedule';
import { RemindTaskRepository } from './RemindTaskRepository';
import { RemindChannelStore } from './RemindChannelStore';
import { RemindMessageManager } from './RemindMessageManager';
import { LoggerManager } from '../utils/LoggerManager';
import type { Logger } from '../utils/logger';
import { CoreApiError } from '../api/CoreClient';

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
    private repository = new RemindTaskRepository(),
    private metadataManager = RemindChannelStore.getInstance(),
    private messageManager = new RemindMessageManager(),
    private logger: Pick<Logger, 'warn'> = LoggerManager.getLogger('RemindTaskService')
  ) {}
  async addTask(channelId: string, input: RemindTaskInputData, client: Client, now = new Date(), listTitle = 'リマインドリスト'): Promise<RemindTaskServiceResult> {
    const metadata = await this.metadataManager.getChannelMetadata(channelId);
    if (!metadata.success) await this.metadataManager.createChannelMetadata(channelId, '', listTitle);
    const task = await this.repository.appendTask(channelId, {
      title: input.title, description: input.description ?? null, intervalDays: input.intervalDays,
      timeOfDay: normalizeTimeOfDay(input.timeOfDay ?? '00:00'), remindBeforeMinutes: input.remindBeforeMinutes ?? 1440,
      inventoryItems: input.inventoryItems ?? []
    });
    let stage = 'create_message';
    const savedWithoutDisplay = (error?: unknown): RemindTaskServiceResult => {
      this.logger.warn('Saved task display failed', {
        channelId, taskId: task.id, stage,
        errorType: error instanceof Error ? error.name : error === undefined ? 'operation_returned_failure' : typeof error,
        ...(error instanceof CoreApiError ? { code: error.code, status: error.status, uncertain: error.uncertain } : {}),
        ...(error && typeof error === 'object' && 'code' in error && typeof error.code === 'number' ? { discordCode: error.code } : {})
      });
      return { success: false, task,
        message: 'タスクは保存されましたが表示できませんでした。再登録せず、初期化で表示を修復してください。初期化後に同じタスクの古いカードが残った場合は、手動で削除してください。' };
    };
    try {
      const message = await this.messageManager.createTaskMessage(channelId, task, client, now);
      if (!message.success || !message.messageId) return savedWithoutDisplay();
      stage = 'save_message_id';
      const result = await this.repository.patchTask(channelId, task, { messageId: message.messageId });
      return { success: true, task: result.task, messageId: message.messageId };
    } catch (error) {
      return savedWithoutDisplay(error);
    }
  }
}
