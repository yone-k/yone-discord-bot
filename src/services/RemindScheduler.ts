import { Client } from 'discord.js';
import { shouldSendOverdue, shouldSendPreReminder } from '../utils/RemindNotification';
import { formatRemainingDuration } from '../utils/RemindDuration';
import { formatInventoryShortageNotice } from '../utils/RemindInventory';
import { InventoryService } from './InventoryService';
import { RemindChannelStore } from './RemindChannelStore';
import { RemindMessageManager } from './RemindMessageManager';
import { RemindTaskRepository } from './RemindTaskRepository';
import { LoggerManager } from '../utils/LoggerManager';
import type { RemindTask } from '../models/RemindTask';

export class RemindScheduler {
  private isRunning = false;
  private timer?: ReturnType<typeof setInterval>;
  private logger = LoggerManager.getLogger('RemindScheduler');

  constructor(
    private metadataManager: RemindChannelStore = RemindChannelStore.getInstance(),
    private repository: RemindTaskRepository = new RemindTaskRepository(),
    private messageManager: RemindMessageManager = new RemindMessageManager(),
    private inventoryService: Pick<InventoryService, 'checkShortageForTask'> = InventoryService.getInstance()
  ) {}

  public start(client: Client): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runOnce(client).catch(error => this.logger.error('Reminder scheduler failed', { error: error instanceof Error ? error.message : 'Unknown error' }));
    }, 60 * 1000);
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  public async runOnce(client: Client, now: Date = new Date()): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const channels = await this.metadataManager.listChannelMetadata();
      for (const channel of channels) {
        await this.processChannel(channel, client, now);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async processChannel(
    channelMetadata: {
      channelId: string;
      remindNoticeThreadId?: string;
      remindNoticeMessageId?: string;
      linkedInventoryChannelId?: string;
    },
    client: Client,
    now: Date
  ): Promise<void> {
    const { channelId, remindNoticeThreadId, remindNoticeMessageId } = channelMetadata;
    const date = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
    const start = new Date(`${date}T00:00:00+09:00`);
    const day = { date, start, end: new Date(start.getTime() + 86400000) };
    const candidates = await this.repository.notificationCandidates(channelId, now, day);
    const progress = now.getMinutes() === 0 ? await this.repository.activeTasks(channelId) : [];
    const tasks = [...new Map([...progress, ...candidates].map(task => [task.id, task])).values()];
    let currentThreadId = remindNoticeThreadId;
    let currentMessageId = remindNoticeMessageId;
    const shouldUpdateProgress = now.getMinutes() === 0;

    for (const task of tasks) {
      if (task.isPaused) {
        continue;
      }

      if (shouldSendPreReminder(task, now)) {
        if (!task.messageId) {
          continue;
        }

        const remainingText = formatRemainingDuration(task.remindBeforeMinutes);
        const inventoryNotice = await this.buildInventoryNotice(channelMetadata, task);

        const sendResult = await this.messageManager.sendReminderToThread(
          channelId,
          currentThreadId,
          currentMessageId,
          `@everyone ${task.title}の期限まであと${remainingText}になりました。${inventoryNotice}`,
          client
        );
        if (!sendResult.success) {
          this.logger.warn('Reminder send failed', { channelId, taskId: task.id, revision: task.revision, kind: 'before', error: sendResult.message });
          continue;
        }
        if (sendResult.threadId && sendResult.parentMessageId) {
          if (sendResult.threadId !== currentThreadId || sendResult.parentMessageId !== currentMessageId) {
            currentThreadId = sendResult.threadId;
            currentMessageId = sendResult.parentMessageId;
            await this.metadataManager.updateChannelMetadata(channelId, {
              remindNoticeThreadId: currentThreadId,
              remindNoticeMessageId: currentMessageId
            });
          }
        }
        const updatedTask = {
          ...task,
          lastRemindDueAt: task.nextDueAt,
          updatedAt: now
        };
        const marked = await this.recordNotification(channelId, task, 'before', now);
        if (!marked) continue;
        if (task.messageId) {
          await this.messageManager.updateTaskMessage(channelId, task.messageId, updatedTask, client, now);
        }
        continue;
      }

      if (shouldSendOverdue(task, now)) {
        if (!task.messageId) {
          continue;
        }

        const sendResult = await this.messageManager.sendReminderToThread(
          channelId,
          currentThreadId,
          currentMessageId,
          `@everyone ${task.title}の期限が切れています。`,
          client
        );
        if (!sendResult.success) {
          this.logger.warn('Reminder send failed', { channelId, taskId: task.id, revision: task.revision, kind: 'overdue', error: sendResult.message });
          continue;
        }
        if (sendResult.threadId && sendResult.parentMessageId) {
          if (sendResult.threadId !== currentThreadId || sendResult.parentMessageId !== currentMessageId) {
            currentThreadId = sendResult.threadId;
            currentMessageId = sendResult.parentMessageId;
            await this.metadataManager.updateChannelMetadata(channelId, {
              remindNoticeThreadId: currentThreadId,
              remindNoticeMessageId: currentMessageId
            });
          }
        }
        const updatedTask = {
          ...task,
          overdueNotifyCount: task.overdueNotifyCount + 1,
          lastOverdueNotifiedAt: now,
          updatedAt: now
        };
        const marked = await this.recordNotification(channelId, task, 'overdue', now);
        if (!marked) continue;
        if (task.messageId) {
          await this.messageManager.updateTaskMessage(channelId, task.messageId, updatedTask, client, now);
        }
        continue;
      }

      if (shouldUpdateProgress && task.messageId) {
        await this.messageManager.updateTaskMessage(channelId, task.messageId, task, client, now);
      }
    }
  }

  private async recordNotification(channelId: string, task: RemindTask, kind: 'before' | 'overdue', now: Date): Promise<boolean> {
    const context = { channelId, taskId: task.id, revision: task.revision, kind };
    try {
      const marked = await this.repository.markNotified(channelId, task, kind, now);
      if (!marked) this.logger.warn('Reminder notification state conflicted', context);
      return marked;
    } catch (error) {
      this.logger.error('Reminder notification state save failed', { ...context, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  private async buildInventoryNotice(
    channelMetadata: {
      channelId: string;
      linkedInventoryChannelId?: string;
    },
    task: Awaited<ReturnType<RemindTaskRepository['fetchTasks']>>[number]
  ): Promise<string> {
    if (!channelMetadata.linkedInventoryChannelId) return '';
    const shortageResult = await this.inventoryService.checkShortageForTask(channelMetadata.channelId, task);
    return shortageResult.kind === 'shortage' ? `\n${formatInventoryShortageNotice(shortageResult.items)}` : '';
  }
}
