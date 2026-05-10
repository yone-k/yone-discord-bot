import { GoogleSheetsService, OperationResult } from './GoogleSheetsService';
import type { InventoryItem } from '../models/InventoryItem';
import { fromSheetRow, getInventorySheetHeaders, toSheetRow } from '../utils/InventorySheetMapper';
import { LoggerManager } from '../utils/LoggerManager';

interface InventoryWriteOptions {
  useLock?: boolean;
}

export class InventoryRepository {
  private googleSheetsService: GoogleSheetsService;
  private readonly logger = LoggerManager.getLogger('InventoryRepository');

  constructor() {
    this.googleSheetsService = GoogleSheetsService.getInstance();
  }

  public getSheetNameForChannel(channelId: string): string {
    return `inventory_${channelId}`;
  }

  private getLockKeyForChannel(channelId: string): string {
    return `inventory_${channelId}`;
  }

  public async fetchAll(channelId: string): Promise<InventoryItem[]> {
    const sheetName = this.getSheetNameForChannel(channelId);
    const data = await this.googleSheetsService.getSheetDataByName(sheetName);
    if (data.length <= 1) {
      return [];
    }

    return data.slice(1).map(row => fromSheetRow(row));
  }

  public async findById(channelId: string, id: string): Promise<InventoryItem | null> {
    const items = await this.fetchAll(channelId);
    return items.find(item => item.id === id) ?? null;
  }

  public async findByName(channelId: string, name: string): Promise<InventoryItem | null> {
    const items = await this.fetchAll(channelId);
    return items.find(item => item.name === name) ?? null;
  }

  public async append(channelId: string, item: InventoryItem): Promise<OperationResult> {
    return this.googleSheetsService.runWithLock(this.getLockKeyForChannel(channelId), async () => {
      const sheetName = this.getSheetNameForChannel(channelId);
      return this.googleSheetsService.appendSheetData(sheetName, [toSheetRow(item)]);
    });
  }

  public async update(
    channelId: string,
    item: InventoryItem,
    options: InventoryWriteOptions = { useLock: true }
  ): Promise<OperationResult> {
    const operation = async (): Promise<OperationResult> => {
      const sheetName = this.getSheetNameForChannel(channelId);
      const data = await this.googleSheetsService.getSheetDataByName(sheetName, { skipCache: true });
      const headers = data[0] ?? getInventorySheetHeaders();
      const targetIndex = data.findIndex((row, index) => index > 0 && row[0] === item.id);
      if (targetIndex === -1) {
        return { success: false, message: 'Item not found' };
      }

      const rows: string[][] = data.slice(1).map(row => row.map(cell => String(cell)));
      rows[targetIndex - 1] = toSheetRow(item).map(value => String(value));
      return this.googleSheetsService.updateSheetData(sheetName, [headers, ...rows]);
    };

    if (options.useLock === false) {
      return operation();
    }

    return this.googleSheetsService.runWithLock(this.getLockKeyForChannel(channelId), operation);
  }

  public async bulkUpdate(
    channelId: string,
    items: InventoryItem[],
    options: InventoryWriteOptions = { useLock: true }
  ): Promise<OperationResult> {
    if (items.length === 0) {
      this.logger.info('Inventory bulk update succeeded', {
        component: 'InventoryRepository',
        method: 'bulkUpdate',
        channelId,
        updatedRows: 0
      });
      return { success: true };
    }

    const operation = async (): Promise<OperationResult> => {
      const sheetName = this.getSheetNameForChannel(channelId);
      const data = await this.googleSheetsService.getSheetDataByName(sheetName, { skipCache: true });
      const headers = data[0] ?? getInventorySheetHeaders();
      const rows: string[][] = data.slice(1).map(row => row.map(cell => String(cell)));
      const itemsById = new Map(items.map(item => [item.id, item]));
      let updatedRows = 0;
      const rewrittenRows = rows.map(row => {
        const item = itemsById.get(row[0]);
        if (item) {
          updatedRows += 1;
        }
        return item ? toSheetRow(item).map(value => String(value)) : row;
      });

      const result = await this.googleSheetsService.updateSheetData(sheetName, [headers, ...rewrittenRows]);
      if (result.success === false) {
        this.logger.warn('Inventory bulk update failed', {
          component: 'InventoryRepository',
          method: 'bulkUpdate',
          channelId,
          itemCount: items.length,
          message: result.message
        });
      } else {
        this.logger.info('Inventory bulk update succeeded', {
          component: 'InventoryRepository',
          method: 'bulkUpdate',
          channelId,
          updatedRows
        });
      }
      return result;
    };

    if (options.useLock === false) {
      return operation();
    }

    return this.googleSheetsService.runWithLock(this.getLockKeyForChannel(channelId), operation);
  }

  public async delete(channelId: string, id: string): Promise<OperationResult> {
    return this.googleSheetsService.runWithLock(this.getLockKeyForChannel(channelId), async () => {
      const sheetName = this.getSheetNameForChannel(channelId);
      const data = await this.googleSheetsService.getSheetDataByName(sheetName, { skipCache: true });
      const headers = data[0] ?? getInventorySheetHeaders();
      const rows = data.slice(1).filter(row => row[0] !== id);
      return this.googleSheetsService.updateSheetData(sheetName, [headers, ...rows]);
    });
  }
}
