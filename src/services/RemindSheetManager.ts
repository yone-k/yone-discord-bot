import { GoogleSheetsService, OperationResult, DataValidationResult } from './GoogleSheetsService';
import { getRemindSheetHeaders } from '../utils/RemindSheetMapper';

export interface RemindSheetResult {
  existed: boolean;
  created?: boolean;
  data?: string[][];
}

export interface RemindDataOperationResult {
  success: boolean;
  message?: string;
  errors?: string[];
}

export class RemindSheetManager {
  private googleSheetsService: GoogleSheetsService;

  constructor() {
    this.googleSheetsService = GoogleSheetsService.getInstance();
  }

  public getSheetNameForChannel(channelId: string): string {
    return `remind_list_${channelId}`;
  }

  public async createChannelSheetWithHeaders(channelId: string): Promise<OperationResult> {
    const sheetName = this.getSheetNameForChannel(channelId);
    const createResult = await this.googleSheetsService.createSheetByName(sheetName);
    if (!createResult.success) {
      return createResult;
    }

    const headerResult = await this.googleSheetsService.appendSheetData(sheetName, [getRemindSheetHeaders()]);
    if (!headerResult.success) {
      return headerResult;
    }

    return { success: true, sheetId: createResult.sheetId };
  }

  public async getOrCreateChannelSheet(channelId: string): Promise<RemindSheetResult> {
    const sheetName = this.getSheetNameForChannel(channelId);
    const existingData = await this.googleSheetsService.getSheetDataByName(sheetName);

    if (existingData.length > 0) {
      return { existed: true, data: existingData };
    }

    const createResult = await this.createChannelSheetWithHeaders(channelId);
    if (!createResult.success) {
      return { existed: false, created: false };
    }

    return { existed: false, created: true };
  }

  public async addDataToChannelSheet(
    channelId: string,
    data: string[][]
  ): Promise<RemindDataOperationResult> {
    const validationResult: DataValidationResult = this.googleSheetsService.validateData(data);
    if (!validationResult.isValid) {
      return {
        success: false,
        errors: validationResult.errors
      };
    }

    const sheetName = this.getSheetNameForChannel(channelId);
    const appendResult = await this.googleSheetsService.appendSheetData(sheetName, data);
    if (!appendResult.success) {
      return { success: false, message: appendResult.message };
    }

    return { success: true };
  }
}
