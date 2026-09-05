import { Client } from 'discord.js';
import { Logger } from '../utils/logger';
import { ListChannelStore } from './ListChannelStore';
import { ListRepository } from '../repositories/contracts';
import { PostgresListRepository } from '../repositories/PostgresListRepository';
export class ListDueReminderScheduler {
  private isRunning = false;
  private timer?: ReturnType<typeof setInterval>;
  private logger = new Logger();
  constructor(private metadataManager: ListChannelStore = ListChannelStore.getInstance(), private repository: ListRepository = new PostgresListRepository()) { }
  public start(client: Client): void {
    if (this.timer)
      return;
    this.timer = setInterval(() => { this.runOnce(client).catch(error => this.logger.error('Due reminders failed', { error: String(error) })); }, 60000);
  }
  public stop(): void { if (this.timer)
    clearInterval(this.timer); this.timer = undefined; }
  public async runOnce(client: Client, now = new Date()): Promise<void> {
    if (this.isRunning)
      return;
    this.isRunning = true;
    try {
      const date = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
      const start = new Date(`${date}T00:00:00+09:00`);
      const candidates = await this.repository.notificationCandidates({ date, start, end: new Date(start.getTime() + 86400000) });
      const channels = new Map((await this.metadataManager.listChannelMetadata()).map(channel => [channel.channelId, channel]));
      for (const item of candidates) {
        const channel = channels.get(item.channelId);
        if (!channel?.operationLogThreadId || !item.until)
          continue;
        try {
          const thread = await client.channels.fetch(channel.operationLogThreadId);
          if (!thread || !('send' in thread))
            continue;
          await thread.send(`@everyone 【${channel.listTitle || 'リスト'}】${item.name} の期限日(${item.until.replace(/-/g, '/')})です。`);
          await this.repository.markNotified(item.id, item.until, now);
        }
        catch (error) {
          this.logger.warn('Due reminder failed', { itemId: item.id, error: String(error) });
        }
      }
    }
    finally {
      this.isRunning = false;
    }
  }
}
