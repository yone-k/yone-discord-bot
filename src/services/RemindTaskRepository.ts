import { GoogleSheetsService, OperationResult } from './GoogleSheetsService';
import { RemindTask } from '../models/RemindTask';
import { fromSheetRow, toSheetRow } from '../utils/RemindSheetMapper';

export class RemindTaskRepository {
  private googleSheetsService: GoogleSheetsService;

  constructor() {
    this.googleSheetsService = GoogleSheetsService.getInstance();
  }

  public getSheetNameForChannel(channelId: string): string {
    return `remind_list_${channelId}`;
  }

  public async fetchTasks(channelId: string): Promise<RemindTask[]> {
    const sheetName = this.getSheetNameForChannel(channelId);
    const data = await this.googleSheetsService.getSheetDataByName(sheetName);
    if (data.length <= 1) {
      return [];
    }

    return data.slice(1).map(row => fromSheetRow(row));
  }

  public async appendTask(channelId: string, task: RemindTask): Promise<OperationResult> {
    const sheetName = this.getSheetNameForChannel(channelId);
    const rows = [toSheetRow(task).map(value => String(value))];
    const validation = this.googleSheetsService.validateData(rows);
    if (!validation.isValid) {
      return { success: false, message: validation.errors?.join(',') };
    }

    return this.googleSheetsService.appendSheetData(sheetName, rows);
  }

  public async updateTask(channelId: string, task: RemindTask): Promise<OperationResult> {
    const sheetName = this.getSheetNameForChannel(channelId);
    const data = await this.googleSheetsService.getSheetDataByName(sheetName);
    if (data.length === 0) {
      return { success: false, message: 'Sheet is empty' };
    }

    const headers = data[0];
    const targetIndex = data.findIndex((row, index) => index > 0 && row[0] === task.id);
    if (targetIndex === -1) {
      return { success: false, message: 'Task not found' };
    }

    const updatedRows = [...data];
    updatedRows[targetIndex] = toSheetRow(task).map(value => String(value));
    const rawData = [headers, ...updatedRows.slice(1)];
    return this.googleSheetsService.updateSheetData(sheetName, rawData);
  }

  public async findTaskByMessageId(channelId: string, messageId: string): Promise<RemindTask | null> {
    const sheetName = this.getSheetNameForChannel(channelId);
    const data = await this.googleSheetsService.getSheetDataByName(sheetName);
    if (data.length <= 1) {
      return null;
    }

    const row = data.slice(1).find(taskRow => taskRow[1] === messageId);
    return row ? fromSheetRow(row) : null;
  }

  public async deleteTask(channelId: string, taskId: string): Promise<OperationResult> {
    const sheetName = this.getSheetNameForChannel(channelId);
    const data = await this.googleSheetsService.getSheetDataByName(sheetName);
    if (data.length === 0) {
      return { success: false, message: 'Sheet is empty' };
    }

    const headers = data[0];
    const remaining = data.slice(1).filter(row => row[0] !== taskId);
    const updated = [headers, ...remaining];
    return this.googleSheetsService.updateSheetData(sheetName, updated);
  }
}
