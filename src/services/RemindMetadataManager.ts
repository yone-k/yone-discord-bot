import { GoogleSheetsService, OperationResult } from './GoogleSheetsService';
import { MetadataProviderResult } from './MetadataProvider';

export interface RemindChannelMetadata {
  channelId: string;
  messageId: string;
  listTitle: string;
  lastSyncTime: Date;
  operationLogThreadId?: string;
  remindNoticeThreadId?: string;
  remindNoticeMessageId?: string;
}

export interface RemindMetadataOperationResult extends MetadataProviderResult {
  metadata?: RemindChannelMetadata;
}

export class RemindMetadataManager {
  private static instance: RemindMetadataManager | undefined;
  private googleSheetsService: GoogleSheetsService;
  private readonly METADATA_SHEET_NAME = 'remind_metadata';
  private readonly metadataHeaders = [
    'channel_id',
    'message_id',
    'list_title',
    'last_sync_time',
    'operation_log_thread_id',
    'remind_notice_thread_id',
    'remind_notice_message_id'
  ];

  private constructor() {
    this.googleSheetsService = GoogleSheetsService.getInstance();
  }

  public static getInstance(): RemindMetadataManager {
    if (!RemindMetadataManager.instance) {
      RemindMetadataManager.instance = new RemindMetadataManager();
    }
    return RemindMetadataManager.instance;
  }

  public async getOrCreateMetadataSheet(): Promise<OperationResult> {
    const existing = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
    if (existing.length > 0) {
      if (existing[0].length < this.metadataHeaders.length) {
        const normalized = this.normalizeSheet(existing);
        const updateResult = await this.googleSheetsService.updateSheetData(this.METADATA_SHEET_NAME, normalized);
        if (!updateResult.success) {
          return { success: false, message: updateResult.message };
        }
      }
      return { success: true };
    }

    const createResult = await this.googleSheetsService.createSheetByName(this.METADATA_SHEET_NAME);
    if (!createResult.success) {
      return createResult;
    }

    const headerResult = await this.googleSheetsService.appendSheetData(this.METADATA_SHEET_NAME, [this.metadataHeaders]);
    if (!headerResult.success) {
      return headerResult;
    }

    return { success: true, sheetId: createResult.sheetId };
  }

  public async getChannelMetadata(channelId: string): Promise<RemindMetadataOperationResult> {
    const sheetData = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
    if (sheetData.length <= 1) {
      return { success: false, message: 'metadataが見つかりません' };
    }

    const row = sheetData.find((dataRow, index) => index > 0 && dataRow[0] === channelId);
    if (!row) {
      return { success: false, message: 'metadataが見つかりません' };
    }

    return {
      success: true,
      metadata: this.parseRow(row)
    };
  }

  public async createChannelMetadata(
    channelId: string,
    messageId: string,
    listTitle: string,
    operationLogThreadId?: string,
    remindNoticeThreadId?: string,
    remindNoticeMessageId?: string
  ): Promise<RemindMetadataOperationResult> {
    await this.getOrCreateMetadataSheet();

    const metadata: RemindChannelMetadata = {
      channelId,
      messageId,
      listTitle,
      lastSyncTime: new Date(),
      operationLogThreadId,
      remindNoticeThreadId,
      remindNoticeMessageId
    };

    const row = this.formatRow(metadata);
    const appendResult = await this.googleSheetsService.appendSheetData(this.METADATA_SHEET_NAME, [row]);
    if (!appendResult.success) {
      return { success: false, message: appendResult.message };
    }

    return { success: true, metadata };
  }

  public async updateChannelMetadata(
    channelId: string,
    updates: Partial<Omit<RemindChannelMetadata, 'channelId'>>
  ): Promise<RemindMetadataOperationResult> {
    let sheetData = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
    if (sheetData.length <= 1) {
      return { success: false, message: 'metadataが見つかりません' };
    }

    if (sheetData[0].length < this.metadataHeaders.length) {
      sheetData = this.normalizeSheet(sheetData);
    }

    const rowIndex = sheetData.findIndex((row, index) => index > 0 && row[0] === channelId);
    if (rowIndex === -1) {
      return { success: false, message: 'metadataが見つかりません' };
    }

    const current = this.parseRow(sheetData[rowIndex]);
    const updated: RemindChannelMetadata = {
      ...current,
      ...updates,
      channelId,
      lastSyncTime: new Date()
    };

    const newData = [...sheetData];
    newData[rowIndex] = this.formatRow(updated);
    const updateResult = await this.googleSheetsService.updateSheetData(this.METADATA_SHEET_NAME, newData);
    if (!updateResult.success) {
      return { success: false, message: updateResult.message };
    }

    return { success: true, metadata: updated };
  }

  public async listChannelMetadata(): Promise<RemindChannelMetadata[]> {
    const sheetData = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
    if (sheetData.length <= 1) {
      return [];
    }

    return sheetData.slice(1).map(row => this.parseRow(row));
  }

  private parseRow(row: string[]): RemindChannelMetadata {
    return {
      channelId: row[0],
      messageId: row[1],
      listTitle: row[2],
      lastSyncTime: this.parseDate(row[3]),
      operationLogThreadId: row[4] || undefined,
      remindNoticeThreadId: row[5] || undefined,
      remindNoticeMessageId: row[6] || undefined
    };
  }

  private formatRow(metadata: RemindChannelMetadata): string[] {
    return [
      metadata.channelId,
      metadata.messageId,
      metadata.listTitle,
      this.formatDate(metadata.lastSyncTime),
      metadata.operationLogThreadId || '',
      metadata.remindNoticeThreadId || '',
      metadata.remindNoticeMessageId || ''
    ];
  }

  private normalizeSheet(sheetData: string[][]): string[][] {
    const normalizedRows = sheetData.map((row, index) => {
      if (index === 0) {
        return this.metadataHeaders;
      }
      const normalized = [...row];
      while (normalized.length < this.metadataHeaders.length) {
        normalized.push('');
      }
      return normalized;
    });

    return normalizedRows;
  }

  private parseDate(value: string): Date {
    if (!value) {
      return new Date();
    }
    const date = new Date(value);
    return isNaN(date.getTime()) ? new Date() : date;
  }

  private formatDate(date: Date): string {
    const jstOffset = 9 * 60;
    const jstDate = new Date(date.getTime() + (jstOffset * 60 * 1000));
    const year = jstDate.getUTCFullYear();
    const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(jstDate.getUTCDate()).padStart(2, '0');
    const hours = String(jstDate.getUTCHours()).padStart(2, '0');
    const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
    const seconds = String(jstDate.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
}
