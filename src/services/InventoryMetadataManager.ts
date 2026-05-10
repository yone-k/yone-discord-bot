import { GoogleSheetsService, OperationResult } from './GoogleSheetsService';
import type { InventoryChannelMetadata } from '../models/InventoryChannelMetadata';

export type { InventoryChannelMetadata } from '../models/InventoryChannelMetadata';

export class InventoryMetadataManager {
  private static instance: InventoryMetadataManager | undefined;
  private googleSheetsService: GoogleSheetsService;
  private readonly METADATA_SHEET_NAME = 'inventory_metadata';
  private readonly metadataHeaders = [
    'channel_id',
    'message_id',
    'list_title',
    'last_sync_time',
    'default_category',
    'operation_log_thread_id'
  ];

  private constructor() {
    this.googleSheetsService = GoogleSheetsService.getInstance();
  }

  public static getInstance(): InventoryMetadataManager {
    if (!InventoryMetadataManager.instance) {
      InventoryMetadataManager.instance = new InventoryMetadataManager();
    }
    return InventoryMetadataManager.instance;
  }

  public async getOrCreateMetadataSheet(): Promise<OperationResult> {
    const existing = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
    if (existing.length > 0) {
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

  public async getChannelMetadata(channelId: string): Promise<InventoryChannelMetadata | null> {
    const sheetData = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
    if (sheetData.length <= 1) {
      return null;
    }

    const row = sheetData.find((dataRow, index) => index > 0 && dataRow[0] === channelId);
    if (!row) {
      return null;
    }

    return this.parseRow(row);
  }

  public async createChannelMetadata(
    channelId: string,
    metadata: Omit<InventoryChannelMetadata, 'channelId' | 'lastSyncTime'> & {
      lastSyncTime?: Date;
    }
  ): Promise<OperationResult> {
    await this.getOrCreateMetadataSheet();

    const channelMetadata: InventoryChannelMetadata = {
      channelId,
      messageId: metadata.messageId,
      listTitle: metadata.listTitle,
      lastSyncTime: metadata.lastSyncTime ?? new Date(),
      defaultCategory: metadata.defaultCategory,
      operationLogThreadId: metadata.operationLogThreadId
    };

    const appendResult = await this.googleSheetsService.appendSheetData(
      this.METADATA_SHEET_NAME,
      [this.formatRow(channelMetadata)]
    );
    if (!appendResult.success) {
      return { success: false, message: appendResult.message };
    }

    return { success: true };
  }

  public async updateChannelMetadata(
    channelId: string,
    metadata: Partial<Omit<InventoryChannelMetadata, 'channelId' | 'lastSyncTime'>> & {
      lastSyncTime?: Date;
    }
  ): Promise<OperationResult> {
    const sheetData = await this.googleSheetsService.getSheetDataByName(
      this.METADATA_SHEET_NAME,
      { skipCache: true }
    );
    if (sheetData.length <= 1) {
      return { success: false, message: 'metadataが見つかりません' };
    }

    const rowIndex = sheetData.findIndex((row, index) => index > 0 && row[0] === channelId);
    if (rowIndex === -1) {
      return { success: false, message: 'metadataが見つかりません' };
    }

    const current = this.parseRow(sheetData[rowIndex]);
    const updated: InventoryChannelMetadata = {
      ...current,
      ...metadata,
      channelId,
      lastSyncTime: metadata.lastSyncTime ?? new Date()
    };

    const newData = [...sheetData];
    newData[rowIndex] = this.formatRow(updated);
    const updateResult = await this.googleSheetsService.updateSheetData(this.METADATA_SHEET_NAME, newData);
    if (!updateResult.success) {
      return { success: false, message: updateResult.message };
    }

    return { success: true };
  }

  private parseRow(row: string[]): InventoryChannelMetadata {
    return {
      channelId: row[0],
      messageId: row[1],
      listTitle: row[2],
      lastSyncTime: this.parseDate(row[3]),
      defaultCategory: row[4],
      operationLogThreadId: row[5] || undefined
    };
  }

  private formatRow(metadata: InventoryChannelMetadata): string[] {
    return [
      metadata.channelId,
      metadata.messageId,
      metadata.listTitle,
      this.formatDate(metadata.lastSyncTime),
      metadata.defaultCategory,
      metadata.operationLogThreadId || ''
    ];
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
