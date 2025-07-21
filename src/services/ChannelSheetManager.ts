import { GoogleSheetsService, OperationResult, DataValidationResult } from './GoogleSheetsService';

export enum ChannelSheetErrorType {
  SHEET_NOT_FOUND = 'SHEET_NOT_FOUND',
  CREATION_FAILED = 'CREATION_FAILED',
  ACCESS_DENIED = 'ACCESS_DENIED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  OPERATION_FAILED = 'OPERATION_FAILED'
}

export class ChannelSheetError extends Error {
  public readonly type: ChannelSheetErrorType;
  public readonly userMessage: string;
  public readonly originalError?: Error;

  constructor(
    type: ChannelSheetErrorType,
    message: string,
    userMessage?: string,
    originalError?: Error
  ) {
    super(message);
    this.name = 'ChannelSheetError';
    this.type = type;
    this.userMessage = userMessage || this.getDefaultUserMessage(type);
    this.originalError = originalError;
  }

  private getDefaultUserMessage(type: ChannelSheetErrorType): string {
    switch (type) {
    case ChannelSheetErrorType.SHEET_NOT_FOUND:
      return 'チャンネル専用のシートが見つかりません。';
    case ChannelSheetErrorType.CREATION_FAILED:
      return 'シートの作成に失敗しました。';
    case ChannelSheetErrorType.ACCESS_DENIED:
      return 'シートへのアクセス権限がありません。';
    case ChannelSheetErrorType.VALIDATION_FAILED:
      return 'データの形式が正しくありません。';
    case ChannelSheetErrorType.OPERATION_FAILED:
      return 'シート操作に失敗しました。';
    default:
      return '予期しないエラーが発生しました。';
    }
  }
}

export interface ChannelSheetResult {
  existed: boolean;
  created?: boolean;
  data?: string[][];
}

export interface DataOperationResult {
  success: boolean;
  message?: string;
  errors?: string[];
}

export class ChannelSheetManager {
  private googleSheetsService: GoogleSheetsService;
  private readonly defaultHeaders = ['項目名', '説明', '日付', '状態'];

  constructor() {
    this.googleSheetsService = GoogleSheetsService.getInstance();
  }

  /**
   * チャンネルIDに基づくシート名を取得
   */
  public getSheetNameForChannel(channelId: string): string {
    return this.googleSheetsService.getSheetNameForChannel(channelId);
  }

  /**
   * チャンネル専用シートの存在確認
   */
  public async channelSheetExists(channelId: string): Promise<boolean> {
    try {
      const data = await this.googleSheetsService.getSheetData(channelId);
      return data.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * ヘッダー行付きでチャンネルシートを作成
   */
  public async createChannelSheetWithHeaders(
    channelId: string, 
    customHeaders?: string[]
  ): Promise<OperationResult> {
    try {
      // シートを作成
      const createResult = await this.googleSheetsService.createChannelSheet(channelId);
      
      if (!createResult.success) {
        return createResult;
      }

      // ヘッダー行を追加
      const headers = customHeaders || this.defaultHeaders;
      const headerResult = await this.googleSheetsService.appendSheetData(channelId, [headers]);
      
      if (!headerResult.success) {
        return headerResult;
      }

      return { success: true, sheetId: createResult.sheetId };
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to create channel sheet: ${(error as Error).message}` 
      };
    }
  }

  /**
   * シートアクセス権限の検証
   */
  public async verifySheetAccess(): Promise<boolean> {
    try {
      // スプレッドシートの存在確認（権限確認を兼ねる）
      const spreadsheetExists = await this.googleSheetsService.checkSpreadsheetExists();
      return spreadsheetExists;
    } catch {
      return false;
    }
  }

  /**
   * シートを取得または作成
   */
  public async getOrCreateChannelSheet(channelId: string): Promise<ChannelSheetResult> {
    try {
      // 既存シートの確認
      const existingData = await this.googleSheetsService.getSheetData(channelId);
      
      if (existingData.length > 0) {
        return {
          existed: true,
          data: existingData
        };
      }

      // 新規シート作成
      const createResult = await this.createChannelSheetWithHeaders(channelId);
      
      if (!createResult.success) {
        throw new ChannelSheetError(
          ChannelSheetErrorType.CREATION_FAILED,
          `Failed to create channel sheet: ${createResult.message}`
        );
      }

      return {
        existed: false,
        created: true
      };
    } catch (error) {
      if (error instanceof ChannelSheetError) {
        throw error;
      }
      throw new ChannelSheetError(
        ChannelSheetErrorType.OPERATION_FAILED,
        `Failed to get or create channel sheet: ${(error as Error).message}`
      );
    }
  }

  /**
   * チャンネルシートにデータを追加
   */
  public async addDataToChannelSheet(
    channelId: string, 
    data: string[][]
  ): Promise<DataOperationResult> {
    try {
      // データ検証
      const validationResult: DataValidationResult = this.googleSheetsService.validateData(data);
      
      if (!validationResult.isValid) {
        return {
          success: false,
          errors: validationResult.errors
        };
      }

      // データ正規化
      const normalizedData = this.googleSheetsService.normalizeData(data);

      // データ追加
      const appendResult = await this.googleSheetsService.appendSheetData(channelId, normalizedData);
      
      if (!appendResult.success) {
        return {
          success: false,
          message: appendResult.message
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: `Failed to add data: ${(error as Error).message}`
      };
    }
  }
}