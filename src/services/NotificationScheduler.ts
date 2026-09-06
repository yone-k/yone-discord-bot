import type { Client } from 'discord.js';
import type { Schema } from '../api/contracts';
import { coreClient } from '../api/CoreClient';
import { hydrateTask } from '../api/Repositories';
import { fromStoredTask } from './RemindTaskRepository';
import { RemindMessageManager } from './RemindMessageManager';
import { RemindChannelStore } from './RemindChannelStore';
import { LoggerManager } from '../utils/LoggerManager';
import { formatRemainingDuration } from '../utils/RemindDuration';
import { formatInventoryShortageNotice } from '../utils/RemindInventory';

interface NotificationApi {
  poll(): Promise<Schema['NotificationPlan']>;
  ack(token: Schema['NotificationToken']): Promise<Schema['NotificationAckResult']>;
}
export class NotificationScheduler {
  private running = false;
  private timer?: ReturnType<typeof setInterval>;
  private logger = LoggerManager.getLogger('NotificationScheduler');
  constructor(private readonly api: NotificationApi = {
    poll: () => coreClient().request('POST', '/v1/notifications/poll'),
    ack: token => coreClient().request('POST', '/v1/notifications/ack', token)
  }, private readonly messages: Pick<RemindMessageManager, 'sendReminderToThread' | 'updateTaskMessage'> = new RemindMessageManager(),
  private readonly metadata: Pick<RemindChannelStore, 'updateChannelMetadata'> = RemindChannelStore.getInstance()) {}

  start(client: Client): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.runOnce(client).catch(error => this.logger.error('Notification poll failed', { error: error instanceof Error ? error.message : 'Unknown error' })); }, 60000);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async runOnce(client: Client): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const plan = await this.api.poll();
      const threadIds = new Map<string, { threadId: string; parentMessageId: string }>();
      const notificationTargets = new Set(plan.notifications.filter(value => value.kind !== 'list').map(value => JSON.stringify([value.channelId, value.id])));
      for (const notification of plan.notifications) {
        try { await this.deliver(notification, client, threadIds); }
        catch (error) { this.logger.warn('Notification delivery or acknowledgement failed', { channelId: notification.channelId, id: notification.id, kind: notification.kind, error: error instanceof Error ? error.message : 'Unknown error' }); }
      }
      for (const update of plan.progress) {
        if (notificationTargets.has(JSON.stringify([update.reminder.channel.channelId, update.reminder.task.id]))) continue;
        try {
          const task = fromStoredTask(hydrateTask(update.reminder.task));
          if (task.messageId) {
            const rendered = await this.messages.updateTaskMessage(update.reminder.channel.channelId, task.messageId, task, client, new Date(update.evaluatedAt));
            if (!rendered.success) throw new Error('進捗の表示更新に失敗しました');
          }
        } catch (error) { this.logger.warn('Progress rendering failed', { error: error instanceof Error ? error.message : 'Unknown error' }); }
      }
    } finally { this.running = false; }
  }
  private async deliver(notification: Schema['Notification'], client: Client, threadIds: Map<string, { threadId: string; parentMessageId: string }>): Promise<void> {
    const { kind, channelId, id, evaluatedAt, targetDueAt, expectedRevision } = notification;
    if (kind === 'list') {
      const settings = notification.list?.channel;
      const item = notification.item;
      if (!settings?.operationLogThreadId || !item?.until) return;
      const thread = await client.channels.fetch(settings.operationLogThreadId);
      if (!thread || !('send' in thread)) return;
      await thread.send(`@everyone 【${settings.listTitle || 'リスト'}】${item.name} の期限日(${item.until.replace(/-/g, '/')})です。`);
    } else {
      const display = notification.reminder;
      if (!display || !display.task.messageId) return;
      const current = threadIds.get(channelId);
      const threadId = current?.threadId ?? display.channel.remindNoticeThreadId ?? undefined;
      const parentMessageId = current?.parentMessageId ?? display.channel.remindNoticeMessageId ?? undefined;
      const shortage = display.shortages.length ? `\n${formatInventoryShortageNotice(display.shortages)}` : '';
      const content = kind === 'before'
        ? `@everyone ${display.task.title}の期限まであと${formatRemainingDuration(display.task.remindBeforeMinutes)}になりました。${shortage}`
        : `@everyone ${display.task.title}の期限が切れています。`;
      const sent = await this.messages.sendReminderToThread(channelId, threadId, parentMessageId, content, client);
      if (!sent.success) throw new Error('Discordへの通知送信に失敗しました');
      if (sent.threadId && sent.parentMessageId && (sent.threadId !== threadId || sent.parentMessageId !== parentMessageId)) {
        await this.metadata.updateChannelMetadata(channelId, { remindNoticeThreadId: sent.threadId, remindNoticeMessageId: sent.parentMessageId });
        threadIds.set(channelId, { threadId: sent.threadId, parentMessageId: sent.parentMessageId });
      }
    }
    const acknowledged = await this.api.ack({ kind, channelId, id, evaluatedAt, targetDueAt, expectedRevision });
    if (acknowledged.task?.messageId) {
      const task = fromStoredTask(hydrateTask(acknowledged.task));
      const rendered = await this.messages.updateTaskMessage(channelId, acknowledged.task.messageId, task, client, new Date(evaluatedAt));
      if (!rendered.success) throw new Error('通知は記録されましたが表示更新に失敗しました');
    }
  }
}
