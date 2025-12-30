import { Client } from 'discord.js';
import { shouldSendOverdue, shouldSendPreReminder } from '../utils/RemindNotification';
import { formatRemainingDuration } from '../utils/RemindDuration';
import { RemindMetadataManager } from './RemindMetadataManager';
import { RemindMessageManager } from './RemindMessageManager';
import { RemindTaskRepository } from './RemindTaskRepository';

export class RemindScheduler {
  private isRunning = false;

  constructor(
    private metadataManager: RemindMetadataManager = RemindMetadataManager.getInstance(),
    private repository: RemindTaskRepository = new RemindTaskRepository(),
    private messageManager: RemindMessageManager = new RemindMessageManager()
  ) {}

  public start(client: Client): void {
    setInterval(() => {
      this.runOnce(client).catch(() => undefined);
    }, 60 * 1000);
  }

  public async runOnce(client: Client, now: Date = new Date()): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const channels = await this.metadataManager.listChannelMetadata();
      for (const channel of channels) {
        await this.processChannel(channel.channelId, client, now);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async processChannel(channelId: string, client: Client, now: Date): Promise<void> {
    const tasks = await this.repository.fetchTasks(channelId);

    for (const task of tasks) {
      if (task.isPaused) {
        continue;
      }

      if (shouldSendPreReminder(task, now)) {
        if (!task.messageId) {
          continue;
        }

        const remainingText = formatRemainingDuration(task.remindBeforeMinutes);

        await this.messageManager.sendReminderToThread(
          channelId,
          task.messageId,
          `@everyone ${task.title}の期限まであと${remainingText}になりました。`,
          client
        );
        const updatedTask = {
          ...task,
          lastRemindDueAt: task.nextDueAt,
          updatedAt: now
        };
        await this.repository.updateTask(channelId, updatedTask);
        if (task.messageId) {
          await this.messageManager.updateTaskMessage(channelId, task.messageId, updatedTask, client, now);
        }
        continue;
      }

      if (shouldSendOverdue(task, now)) {
        if (!task.messageId) {
          continue;
        }

        await this.messageManager.sendReminderToThread(
          channelId,
          task.messageId,
          `@everyone ${task.title}の期限が切れています。`,
          client
        );
        const updatedTask = {
          ...task,
          overdueNotifyCount: task.overdueNotifyCount + 1,
          lastOverdueNotifiedAt: now,
          updatedAt: now
        };
        await this.repository.updateTask(channelId, updatedTask);
        if (task.messageId) {
          await this.messageManager.updateTaskMessage(channelId, task.messageId, updatedTask, client, now);
        }
      }
    }
  }
}
