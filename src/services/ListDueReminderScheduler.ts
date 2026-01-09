import { Client } from 'discord.js';
import { Logger } from '../utils/logger';
import { MetadataManager } from './MetadataManager';
import { GoogleSheetsService } from './GoogleSheetsService';
import { ListItem } from '../models/ListItem';
import { formatTokyoDate, shouldSendListDueReminder } from '../utils/ListDueReminder';

type ChannelReminderMetadata = {
  channelId: string;
  listTitle?: string;
  defaultCategory?: string;
  operationLogThreadId?: string;
};

export class ListDueReminderScheduler {
  private isRunning = false;
  private logger: Logger;

  constructor(
    private metadataManager: MetadataManager = MetadataManager.getInstance(),
    private googleSheetsService: GoogleSheetsService = GoogleSheetsService.getInstance()
  ) {
    this.logger = new Logger();
  }

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
    channelMetadata: ChannelReminderMetadata,
    client: Client,
    now: Date
  ): Promise<void> {
    const { channelId, listTitle, operationLogThreadId } = channelMetadata;

    if (!operationLogThreadId) {
      this.logger.debug('Operation log thread is missing, skipping due reminder', { channelId });
      return;
    }

    const rawData = await this.googleSheetsService.getSheetData(channelId);
    if (rawData.length === 0) {
      return;
    }

    const normalizedData = this.googleSheetsService.normalizeData(rawData);
    const items = this.convertToListItems(normalizedData);
    if (items.length === 0) {
      return;
    }

    const dueItems = items.filter(item => shouldSendListDueReminder(item, now));
    if (dueItems.length === 0) {
      return;
    }

    const thread = await client.channels.fetch(operationLogThreadId);
    if (!thread || !('send' in thread)) {
      this.logger.warn('Operation log thread not found or not sendable', {
        channelId,
        operationLogThreadId
      });
      return;
    }

    const title = listTitle && listTitle.trim() !== '' ? listTitle : 'リスト';
    for (const item of dueItems) {
      const dueText = item.until ? formatTokyoDate(item.until) : '';
      const message = `@everyone 【${title}】${item.name} の期限日(${dueText})です。`;
      await thread.send(message);
      item.lastNotifiedAt = now;
    }

    const sheetData = this.convertItemsToSheetData(items);
    const updateResult = await this.googleSheetsService.updateSheetData(channelId, sheetData);
    if (!updateResult.success) {
      this.logger.warn('Failed to update last_notified_at in sheet', {
        channelId,
        message: updateResult.message
      });
    }
  }

  private convertToListItems(data: (string | number)[][]): ListItem[] {
    const items: ListItem[] = [];
    const startIndex = data.length > 0 && this.isHeaderRow(data[0]) ? 1 : 0;

    for (let i = startIndex; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 1 && row[0]) {
        try {
          const nameValue = row[0];
          const name = typeof nameValue === 'string' ? nameValue.trim() : String(nameValue);
          let until: Date | null = null;
          if (row.length > 2 && row[2]) {
            const untilValue = typeof row[2] === 'string' ? row[2].trim() : String(row[2]);
            if (untilValue !== '') {
              const dateValue = new Date(untilValue);
              until = !isNaN(dateValue.getTime()) ? dateValue : null;
            }
          }

          const category = row.length > 1 && row[1] ? String(row[1]).trim() : '';

          let check = false;
          if (row.length > 3 && row[3]) {
            const checkValue = typeof row[3] === 'string' ? row[3].trim() : String(row[3]);
            check = checkValue === '1';
          }

          let lastNotifiedAt: Date | null = null;
          if (row.length > 4 && row[4]) {
            const notifyValue = typeof row[4] === 'string' ? row[4].trim() : String(row[4]);
            if (notifyValue !== '') {
              const dateValue = new Date(notifyValue);
              lastNotifiedAt = !isNaN(dateValue.getTime()) ? dateValue : null;
            }
          }

          items.push({
            name,
            category,
            until,
            check,
            lastNotifiedAt
          });
        } catch (error) {
          this.logger.warn('Failed to convert row to ListItem', {
            rowIndex: i,
            row,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    return items;
  }

  private convertItemsToSheetData(items: ListItem[]): (string | number)[][] {
    const data: (string | number)[][] = [];
    data.push(['name', 'category', 'until', 'check', 'last_notified_at']);

    for (const item of items) {
      data.push([
        item.name,
        item.category || '',
        item.until ? this.formatDateForSheet(item.until) : '',
        item.check ? 1 : 0,
        item.lastNotifiedAt ? item.lastNotifiedAt.toISOString() : ''
      ]);
    }

    return data;
  }

  private formatDateForSheet(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private isHeaderRow(row: (string | number)[]): boolean {
    const headers = ['name', 'category', 'until', 'check', 'last_notified_at'];
    return headers.some(header =>
      row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes(header))
    );
  }
}
