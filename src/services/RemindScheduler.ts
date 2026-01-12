import { Client } from 'discord.js';
import { shouldSendOverdue, shouldSendPreReminder } from '../utils/RemindNotification';
import { formatRemainingDuration } from '../utils/RemindDuration';
import { formatInventoryShortage, getInsufficientInventoryItems } from '../utils/RemindInventory';
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
        await this.processChannel(channel, client, now);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async processChannel(
    channelMetadata: { channelId: string; remindNoticeThreadId?: string; remindNoticeMessageId?: string },
    client: Client,
    now: Date
  ): Promise<void> {
    const { channelId, remindNoticeThreadId, remindNoticeMessageId } = channelMetadata;
    const tasks = await this.repository.fetchTasks(channelId);
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
        const insufficientItems = getInsufficientInventoryItems(task.inventoryItems);

        if (insufficientItems.length > 0) {
          const shortageResult = await this.messageManager.sendReminderToThread(
            channelId,
            currentThreadId,
            currentMessageId,
            `@everyone ${task.title}の在庫が不足しています: ${formatInventoryShortage(insufficientItems)}`,
            client
          );
          if (shortageResult.threadId && shortageResult.parentMessageId) {
            if (shortageResult.threadId !== currentThreadId || shortageResult.parentMessageId !== currentMessageId) {
              currentThreadId = shortageResult.threadId;
              currentMessageId = shortageResult.parentMessageId;
              await this.metadataManager.updateChannelMetadata(channelId, {
                remindNoticeThreadId: currentThreadId,
                remindNoticeMessageId: currentMessageId
              });
            }
          }
        }

        const sendResult = await this.messageManager.sendReminderToThread(
          channelId,
          currentThreadId,
          currentMessageId,
          `@everyone ${task.title}の期限まであと${remainingText}になりました。`,
          client
        );
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

        const sendResult = await this.messageManager.sendReminderToThread(
          channelId,
          currentThreadId,
          currentMessageId,
          `@everyone ${task.title}の期限が切れています。`,
          client
        );
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
        await this.repository.updateTask(channelId, updatedTask);
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
}
