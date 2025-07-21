import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { Config } from '../utils/config';

export enum GoogleSheetsErrorType {
  CONFIG_MISSING = 'CONFIG_MISSING',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  SPREADSHEET_NOT_FOUND = 'SPREADSHEET_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RATE_LIMITED = 'RATE_LIMITED',
  SHEET_NOT_FOUND = 'SHEET_NOT_FOUND',
  DATA_VALIDATION_ERROR = 'DATA_VALIDATION_ERROR',
  API_ERROR = 'API_ERROR'
}

export class GoogleSheetsError extends Error {
  public readonly type: GoogleSheetsErrorType;
  public readonly originalError?: Error;
  public readonly userMessage: string;

  constructor(
    type: GoogleSheetsErrorType,
    message: string,
    userMessage?: string,
    originalError?: Error
  ) {
    super(message);
    this.name = 'GoogleSheetsError';
    this.type = type;
    this.userMessage = userMessage || this.getDefaultUserMessage(type);
    this.originalError = originalError;
  }

  private getDefaultUserMessage(type: GoogleSheetsErrorType): string {
    switch (type) {
    case GoogleSheetsErrorType.CONFIG_MISSING:
      return 'Google Sheetsの設定が見つかりません。環境変数を確認してください。';
    case GoogleSheetsErrorType.AUTHENTICATION_FAILED:
      return 'Google Sheetsの認証に失敗しました。';
    case GoogleSheetsErrorType.SPREADSHEET_NOT_FOUND:
      return 'スプレッドシートが見つかりません。';
    case GoogleSheetsErrorType.PERMISSION_DENIED:
      return 'スプレッドシートへのアクセス権限がありません。';
    case GoogleSheetsErrorType.RATE_LIMITED:
      return 'APIリクエストの制限に達しました。しばらく時間を置いてから再試行してください。';
    case GoogleSheetsErrorType.SHEET_NOT_FOUND:
      return '指定されたシートが見つかりません。';
    case GoogleSheetsErrorType.DATA_VALIDATION_ERROR:
      return 'データの形式が正しくありません。';
    case GoogleSheetsErrorType.API_ERROR:
      return 'Google Sheets APIでエラーが発生しました。';
    default:
      return '予期しないエラーが発生しました。';
    }
  }
}

export interface SheetMetadata {
  title: string
  sheetId: number
  rowCount: number
  columnCount: number
}

export interface DataValidationResult {
  isValid: boolean
  errors: string[]
}

export interface OperationResult {
  success: boolean
  sheetId?: number
  message?: string
}

export class GoogleSheetsService {
  private static instance: GoogleSheetsService;
  private auth: GoogleAuth | null = null;
  private sheets: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private config: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000;

  private constructor() {
    const configInstance = Config.getInstance();
    this.config = configInstance.getGoogleSheetsConfig();
    
    if (!this.config) {
      throw new GoogleSheetsError(
        GoogleSheetsErrorType.CONFIG_MISSING,
        'Google Sheets configuration is missing'
      );
    }
  }

  public static getInstance(): GoogleSheetsService {
    if (!GoogleSheetsService.instance) {
      GoogleSheetsService.instance = new GoogleSheetsService();
    }
    return GoogleSheetsService.instance;
  }

  public async getAuthClient(): Promise<GoogleAuth> {
    if (this.auth) {
      return this.auth;
    }

    try {
      // プライベートキーの形式を正規化（PEMヘッダー/フッターを自動追加）
      const normalizedPrivateKey = this.normalizePrivateKey(this.config.privateKey);
      
      this.auth = new GoogleAuth({
        credentials: {
          client_email: this.config.serviceAccountEmail,
          private_key: normalizedPrivateKey
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      return this.auth;
    } catch (error) {
      console.error('Google Sheets authentication error details:', {
        hasServiceAccountEmail: !!this.config.serviceAccountEmail,
        serviceAccountEmailLength: this.config.serviceAccountEmail?.length || 0,
        hasPrivateKey: !!this.config.privateKey,
        privateKeyLength: this.config.privateKey?.length || 0,
        privateKeyStart: this.config.privateKey?.substring(0, 50) || 'null',
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack
      });
      
      throw new GoogleSheetsError(
        GoogleSheetsErrorType.AUTHENTICATION_FAILED,
        'Failed to initialize Google Auth client',
        undefined,
        error as Error
      );
    }
  }

  public async checkSpreadsheetExists(): Promise<boolean> {
    try {
      await this.getAuthClient();
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.config.spreadsheetId
      });
      console.log('Spreadsheet access successful:', {
        spreadsheetId: this.config.spreadsheetId,
        title: response.data.properties?.title
      });
      return !!response.data;
    } catch (error) {
      const gaxiosError = error as { code?: number; status?: number; message: string };
      console.error('Spreadsheet access failed:', {
        spreadsheetId: this.config.spreadsheetId,
        errorMessage: gaxiosError.message,
        errorCode: gaxiosError.code || 'unknown',
        errorStatus: gaxiosError.status || 'unknown'
      });
      return false;
    }
  }

  public getSheetNameForChannel(channelId: string): string {
    return `list_${channelId}`;
  }

  public async createChannelSheet(channelId: string): Promise<OperationResult> {
    try {
      await this.getAuthClient();
      const sheetName = this.getSheetNameForChannel(channelId);
      
      const response = await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.config.spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }]
        }
      });

      const sheetId = response.data.replies[0].addSheet.properties.sheetId;
      return { success: true, sheetId };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  public async getSheetData(channelId: string): Promise<string[][]> {
    return this.executeWithRetry(async () => {
      await this.getAuthClient();
      const sheetName = this.getSheetNameForChannel(channelId);
      
      console.log('Attempting to get sheet data:', {
        channelId,
        sheetName,
        spreadsheetId: this.config.spreadsheetId
      });

      try {
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.config.spreadsheetId,
          range: `${sheetName}!A:Z`
        });

        console.log('Sheet data retrieved successfully:', {
          sheetName,
          dataLength: response.data.values?.length || 0
        });

        return response.data.values || [];
      } catch (error) {
        const gaxiosError = error as { code?: number; status?: number; message: string };
        console.error('Failed to get sheet data:', {
          channelId,
          sheetName,
          errorMessage: gaxiosError.message,
          errorCode: gaxiosError.code,
          errorStatus: gaxiosError.status
        });

        // シートが存在しない場合（400エラー + "Unable to parse range"）は空配列を返す
        if (gaxiosError.code === 400 && gaxiosError.message.includes('Unable to parse range')) {
          console.log('Sheet does not exist, returning empty array:', { sheetName });
          return [];
        }

        throw error;
      }
    });
  }

  public async appendSheetData(channelId: string, data: string[][]): Promise<OperationResult> {
    try {
      await this.getAuthClient();
      const sheetName = this.getSheetNameForChannel(channelId);
      
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.config.spreadsheetId,
        range: `${sheetName}!A:Z`,
        valueInputOption: 'RAW',
        resource: {
          values: data
        }
      });

      return { success: true };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  public validateData(data: string[][]): DataValidationResult {
    const errors: string[] = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      // 最低3列必要（項目名、説明、日付）
      if (row.length < 3) {
        errors.push(`行 ${i + 1}: 必要な列数が不足しています`);
        continue;
      }

      // 項目名のチェック
      if (!row[0] || row[0].trim() === '') {
        errors.push(`行 ${i + 1}: 項目名が空です`);
      }

      // 日付のチェック
      if (row[2] && !this.isValidDate(row[2])) {
        errors.push(`行 ${i + 1}: 日付の形式が正しくありません`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  public normalizeData(data: string[][]): string[][] {
    return data.map(row => row.map(cell => {
      if (typeof cell !== 'string') return cell;
      
      // 前後の空白を削除
      let normalized = cell.trim();
      
      // 日付形式の正規化 (YYYY/MM/DD → YYYY-MM-DD)
      if (this.isDateLike(normalized)) {
        normalized = normalized.replace(/\//g, '-');
      }
      
      return normalized;
    }));
  }

  public async getSheetMetadata(channelId: string): Promise<SheetMetadata> {
    await this.getAuthClient();
    const sheetName = this.getSheetNameForChannel(channelId);
    
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId
    });

    const sheet = response.data.sheets.find((s: any) => s.properties.title === sheetName); // eslint-disable-line @typescript-eslint/no-explicit-any
    
    return {
      title: sheet.properties.title,
      sheetId: sheet.properties.sheetId,
      rowCount: sheet.properties.gridProperties.rowCount,
      columnCount: sheet.properties.gridProperties.columnCount
    };
  }

  public async updateSheetMetadata(channelId: string, metadata: Partial<SheetMetadata>): Promise<OperationResult> {
    try {
      await this.getAuthClient();
      const currentMetadata = await this.getSheetMetadata(channelId);
      
      const requests = [];
      if (metadata.title) {
        requests.push({
          updateSheetProperties: {
            properties: {
              sheetId: currentMetadata.sheetId,
              title: metadata.title
            },
            fields: 'title'
          }
        });
      }

      if (requests.length > 0) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.config.spreadsheetId,
          requestBody: { requests }
        });
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private isValidDate(dateString: string): boolean {
    const date = new Date(dateString);
    return !isNaN(date.getTime());
  }

  private isDateLike(str: string): boolean {
    return /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(str);
  }

  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        const statusCode = (error as any).code || (error as any).status; // eslint-disable-line @typescript-eslint/no-explicit-any
        
        // リトライ可能なエラーかチェック
        if (this.isRetryableError(statusCode) && attempt < this.maxRetries - 1) {
          const delay = this.retryDelay * Math.pow(2, attempt); // 指数バックオフ
          await this.sleep(delay);
          continue;
        }
        
        // リトライ不可能なエラーまたは最大試行回数に達した場合
        throw error;
      }
    }
    
    throw lastError;
  }

  private isRetryableError(statusCode: number): boolean {
    return statusCode === 429 || // Rate limit
           statusCode === 500 || // Internal server error
           statusCode === 502 || // Bad gateway
           statusCode === 503 || // Service unavailable
           statusCode === 504;    // Gateway timeout
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private normalizePrivateKey(privateKey: string): string {
    if (!privateKey) {
      throw new Error('Private key is empty or undefined');
    }

    // 既にPEMヘッダー/フッターがある場合はそのまま返す
    if (privateKey.includes('-----BEGIN PRIVATE KEY-----') && privateKey.includes('-----END PRIVATE KEY-----')) {
      return privateKey;
    }

    // PEMヘッダー/フッターを追加
    const cleanKey = privateKey.replace(/\\n/g, '\n').trim();
    return `-----BEGIN PRIVATE KEY-----\n${cleanKey}\n-----END PRIVATE KEY-----`;
  }
}