import { google, sheets_v4 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { Config } from '../utils/config';
import { normalizeCategory } from '../models/CategoryType';

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
  
  // Atomic操作用のロックメカニズム
  private readonly operationLocks = new Map<string, Promise<void>>();
  private readonly lockTimeout = 30000; // 30秒のタイムアウト

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
      
      console.log('Creating GoogleAuth with normalized private key');
      console.log('Service account email:', this.config.serviceAccountEmail);
      
      this.auth = new GoogleAuth({
        credentials: {
          client_email: this.config.serviceAccountEmail,
          private_key: normalizedPrivateKey
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      // 認証をテスト
      console.log('Testing authentication...');
      await this.auth.getClient();
      console.log('Authentication test successful');

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      return this.auth;
    } catch (error) {
      const err = error as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      console.error('Google Sheets authentication error details:', {
        hasServiceAccountEmail: !!this.config.serviceAccountEmail,
        serviceAccountEmailLength: this.config.serviceAccountEmail?.length || 0,
        serviceAccountEmail: this.config.serviceAccountEmail?.substring(0, 30) + '...',
        hasPrivateKey: !!this.config.privateKey,
        privateKeyLength: this.config.privateKey?.length || 0,
        privateKeyStart: this.config.privateKey?.substring(0, 100) || 'null',
        privateKeyEnd: this.config.privateKey?.substring(this.config.privateKey.length - 100) || 'null',
        errorMessage: err.message,
        errorCode: err.code,
        errorStack: err.stack,
        errorDetails: err.details || 'No details',
        errorType: err.constructor.name
      });
      
      // OpenSSLエラーの場合は特別な処理
      if (err.code === 'ERR_OSSL_UNSUPPORTED' || err.message.includes('DECODER routines')) {
        console.error('OpenSSL error detected. This usually means the private key format is incorrect.');
        console.error('Common causes:');
        console.error('1. Private key is not properly formatted (missing headers/footers)');
        console.error('2. Line breaks are not properly encoded in environment variable');
        console.error('3. Private key is corrupted or truncated');
        
        throw new GoogleSheetsError(
          GoogleSheetsErrorType.AUTHENTICATION_FAILED,
          'Private key format is not supported. Please check the private key encoding and format.',
          '秘密鍵の形式がサポートされていません。環境変数の設定を確認してください。\n' +
          'ヒント: 環境変数設定時に改行文字が正しくエンコードされているか確認してください。',
          error as Error
        );
      }
      
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
      const err = error as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      console.error('Spreadsheet access failed:', {
        spreadsheetId: this.config.spreadsheetId,
        errorMessage: err.message,
        errorCode: err.code || 'unknown',
        errorStatus: err.status || 'unknown',
        errorType: err.constructor.name,
        errorStack: err.stack
      });
      
      // 認証エラーの場合は再スロー
      if (err.code === 'ERR_OSSL_UNSUPPORTED' || err.message.includes('DECODER routines')) {
        throw error;
      }
      
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

      return this.getSheetDataByName(sheetName);
    });
  }

  public async getSheetDataByName(sheetName: string): Promise<string[][]> {
    return this.executeWithRetry(async () => {
      await this.getAuthClient();

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

  public async appendSheetData(sheetNameOrChannelId: string, data: string[][], isHeader = false): Promise<OperationResult> {
    try {
      await this.getAuthClient();
      // sheetNameOrChannelIdが既にシート名（'metadata'等）の場合はそのまま使用、
      // channelIDらしき場合はgetSheetNameForChannelを呼ぶ
      const sheetName = sheetNameOrChannelId.includes('!') 
        ? sheetNameOrChannelId.split('!')[0]
        : (sheetNameOrChannelId === 'metadata' || sheetNameOrChannelId.startsWith('list_'))
          ? sheetNameOrChannelId
          : this.getSheetNameForChannel(sheetNameOrChannelId);
      
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.config.spreadsheetId,
        range: `${sheetName}!A:Z`,
        valueInputOption: 'RAW',
        resource: {
          values: data
        }
      });

      // ヘッダー行の場合は太字フォーマットを適用
      if (isHeader && data.length > 0) {
        await this.applyHeaderFormatting(sheetNameOrChannelId, data[0].length);
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  /**
   * 特定範囲のシートデータを更新
   */
  public async updateSheetData(
    sheetNameOrChannelId: string, 
    data: string[][], 
    range?: string
  ): Promise<OperationResult> {
    try {
      await this.getAuthClient();
      const sheetName = sheetNameOrChannelId.includes('!') 
        ? sheetNameOrChannelId.split('!')[0]
        : (sheetNameOrChannelId === 'metadata' || sheetNameOrChannelId.startsWith('list_'))
          ? sheetNameOrChannelId
          : this.getSheetNameForChannel(sheetNameOrChannelId);
      
      const updateRange = range || `${sheetName}!A:Z`;
      
      // シート全体をクリア（削除された行を確実に除去するため）
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.config.spreadsheetId,
        range: updateRange
      });

      // 新しいデータを書き込み
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.spreadsheetId,
        range: `${sheetName}!A1`,
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

  /**
   * 操作に対するロックを取得（atomic操作保証用）
   */
  private async acquireOperationLock(lockKey: string): Promise<() => void> {
    const existingLock = this.operationLocks.get(lockKey);
    
    if (existingLock) {
      // 既存のロックが完了するまで待機
      await existingLock.catch(() => {
        // エラーが発生しても待機を続行
      });
    }

    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = (): void => {
        this.operationLocks.delete(lockKey);
        resolve();
      };
    });

    // タイムアウト設定
    const timeoutId = setTimeout(() => {
      releaseLock();
    }, this.lockTimeout);

    this.operationLocks.set(lockKey, lockPromise);

    return () => {
      clearTimeout(timeoutId);
      releaseLock();
    };
  }

  /**
   * スプレッドシートのバックアップを作成（ロールバック用）
   */
  private async createDataBackup(sheetName: string): Promise<string[][]> {
    try {
      return await this.getSheetDataByName(sheetName);
    } catch (error) {
      // バックアップ作成に失敗した場合は空配列を返す
      console.warn(`Failed to create backup for sheet ${sheetName}:`, (error as Error).message);
      return [];
    }
  }

  /**
   * データのロールバックを実行
   */
  private async rollbackData(sheetName: string, backupData: string[][]): Promise<boolean> {
    try {
      if (backupData.length === 0) {
        console.warn(`No backup data available for rollback of sheet ${sheetName}`);
        return false;
      }

      // シート全体をクリア
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.config.spreadsheetId,
        range: `${sheetName}!A:Z`
      });

      // バックアップデータを復元
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        resource: {
          values: backupData
        }
      });

      return true;
    } catch (error) {
      console.error(`Failed to rollback data for sheet ${sheetName}:`, (error as Error).message);
      return false;
    }
  }

  /**
   * 条件付きデータ追加（真のatomic操作）
   */
  private async conditionalAppend(
    sheetName: string,
    data: string[][],
    checkColumnIndex: number,
    expectedDataLength: number
  ): Promise<{ success: boolean; currentData?: string[][]; message?: string }> {
    try {
      // 現在のデータを再取得して長さを確認
      const currentData = await this.getSheetDataByName(sheetName);
      
      if (currentData.length !== expectedDataLength) {
        return {
          success: false,
          currentData,
          message: `Data length mismatch. Expected: ${expectedDataLength}, Actual: ${currentData.length}`
        };
      }

      // 重複チェック
      for (const newRow of data) {
        const checkValue = newRow[checkColumnIndex];
        const duplicate = currentData.some((existingRow: string[]) => 
          existingRow[checkColumnIndex] === checkValue
        );
        
        if (duplicate) {
          return {
            success: false,
            currentData,
            message: `重複データが検出されました: ${checkValue}`
          };
        }
      }

      // データ追加
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
      return {
        success: false,
        message: `Conditional append failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * 重複チェック付きでシートにデータを追加（atomic操作強化版）
   */
  public async appendSheetDataWithDuplicateCheck(
    sheetNameOrChannelId: string, 
    data: string[][], 
    checkColumnIndex: number,
    isHeader = false
  ): Promise<OperationResult> {
    const lockKey = `append_${sheetNameOrChannelId}`;
    let releaseLock: (() => void) | null = null;
    let backupData: string[][] = [];
    let operationStarted = false;

    try {
      await this.getAuthClient();
      const sheetName = sheetNameOrChannelId.includes('!') 
        ? sheetNameOrChannelId.split('!')[0]
        : (sheetNameOrChannelId === 'metadata' || sheetNameOrChannelId.startsWith('list_'))
          ? sheetNameOrChannelId
          : this.getSheetNameForChannel(sheetNameOrChannelId);

      // ロックを取得してatomic操作を保証
      releaseLock = await this.acquireOperationLock(lockKey);

      // バックアップを作成（ロールバック用）
      backupData = await this.createDataBackup(sheetName);
      const initialDataLength = backupData.length;

      // 最大リトライ回数でatomic操作を試行
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          // 条件付き追加を実行
          const result = await this.conditionalAppend(
            sheetName,
            data,
            checkColumnIndex,
            initialDataLength
          );

          if (result.success) {
            operationStarted = true;

            // ヘッダー行の場合は太字フォーマットを適用
            if (isHeader && data.length > 0) {
              try {
                await this.applyHeaderFormatting(sheetNameOrChannelId, data[0].length);
              } catch (formatError) {
                console.warn(`Failed to apply header formatting: ${(formatError as Error).message}`);
                // フォーマット失敗はデータ追加の成功に影響しないため、警告のみ
              }
            }

            return { success: true };
          } else {
            // 重複エラーの場合はリトライしない
            if (result.message?.includes('重複データが検出されました')) {
              return {
                success: false,
                message: result.message
              };
            }

            // データ長不一致の場合は別のプロセスが同時実行している可能性
            if (result.message?.includes('Data length mismatch')) {
              if (attempt === this.maxRetries) {
                return {
                  success: false,
                  message: '同時実行により操作が競合しました。しばらく時間をおいて再試行してください。'
                };
              }

              // 短時間待機してリトライ
              await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
              continue;
            }

            lastError = new Error(result.message || 'Unknown error');
          }
        } catch (error) {
          lastError = error as Error;
          
          // レート制限エラーの場合は待機してリトライ
          if (lastError.message.includes('429') || lastError.message.includes('quota')) {
            if (attempt < this.maxRetries) {
              await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
              continue;
            }
          }
          
          // その他のエラーは即座に失敗
          break;
        }
      }

      // 全ての試行が失敗した場合
      return {
        success: false,
        message: `操作が失敗しました: ${lastError?.message || 'Unknown error'}`
      };

    } catch (error) {
      // 予期しないエラーが発生した場合
      const errorMessage = (error as Error).message;
      
      // ロールバックを試行
      if (operationStarted && backupData.length > 0) {
        try {
          const sheetName = sheetNameOrChannelId.includes('!') 
            ? sheetNameOrChannelId.split('!')[0]
            : (sheetNameOrChannelId === 'metadata' || sheetNameOrChannelId.startsWith('list_'))
              ? sheetNameOrChannelId
              : this.getSheetNameForChannel(sheetNameOrChannelId);
          
          const rollbackSuccess = await this.rollbackData(sheetName, backupData);
          if (rollbackSuccess) {
            console.log(`Successfully rolled back data for sheet ${sheetName}`);
          }
        } catch (rollbackError) {
          console.error(`Failed to rollback data: ${(rollbackError as Error).message}`);
        }
      }

      return { 
        success: false, 
        message: `操作中に予期しないエラーが発生しました: ${errorMessage}` 
      };
    } finally {
      // ロックを解放
      if (releaseLock) {
        releaseLock();
      }
    }
  }

  /**
   * ヘッダー行に太字フォーマットを適用
   */
  private async applyHeaderFormatting(sheetNameOrChannelId: string, columnCount: number): Promise<void> {
    try {
      await this.getAuthClient();
      // sheetNameOrChannelIdが既にシート名（'metadata'等）の場合はそのまま使用、
      // channelIDらしき場合はgetSheetNameForChannelを呼ぶ
      const sheetName = sheetNameOrChannelId.includes('!') 
        ? sheetNameOrChannelId.split('!')[0]
        : (sheetNameOrChannelId === 'metadata' || sheetNameOrChannelId.startsWith('list_'))
          ? sheetNameOrChannelId
          : this.getSheetNameForChannel(sheetNameOrChannelId);
      
      // シート情報を取得してsheetIdを特定
      const spreadsheetResponse = await this.sheets.spreadsheets.get({
        spreadsheetId: this.config.spreadsheetId
      });
      
      const sheet = spreadsheetResponse.data.sheets?.find(
        (s: sheets_v4.Schema$Sheet) => s.properties?.title === sheetName
      );
      
      if (!sheet?.properties?.sheetId) {
        throw new Error(`Sheet ${sheetName} not found`);
      }
      
      const sheetId = sheet.properties.sheetId;
      
      // ヘッダー行（1行目）に太字フォーマットを適用
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.config.spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: columnCount
              },
              cell: {
                userEnteredFormat: {
                  textFormat: {
                    bold: true
                  }
                }
              },
              fields: 'userEnteredFormat.textFormat.bold'
            }
          }]
        }
      });
    } catch (error) {
      console.error('Failed to apply header formatting:', error);
      // フォーマット適用に失敗してもデータ追加は成功として扱う
    }
  }

  public validateData(data: string[][]): DataValidationResult {
    const errors: string[] = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      // 最低3列必要
      if (row.length < 3) {
        errors.push(`行 ${i + 1}: 必要な列数が不足しています`);
        continue;
      }

      // 1列目が空の場合
      if (!row[0] || row[0].trim() === '') {
        errors.push(`行 ${i + 1}: 1列目が空です`);
      }

      // 日付っぽい列があれば検証
      for (let j = 0; j < row.length; j++) {
        if (row[j] && this.isDateLike(row[j]) && !this.isValidDate(row[j])) {
          errors.push(`行 ${i + 1}: 列 ${j + 1} の日付形式が正しくありません`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  public normalizeData(data: string[][]): string[][] {
    return data.map(row => row.map((cell, columnIndex) => {
      if (typeof cell !== 'string') return cell;
      
      // 前後の空白を削除
      const normalized = cell.trim();
      
      // 空白文字列の適切な処理
      if (normalized === '') {
        return normalized;
      }
      
      // 日付形式の正規化（YYYY/MM/DD -> YYYY-MM-DD）
      if (this.isDateLike(normalized) && normalized.includes('/')) {
        try {
          const date = new Date(normalized);
          if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
        } catch {
          // 日付変換に失敗した場合は元の値をそのまま返す
        }
      }
      
      // 列に応じた追加の正規化処理
      switch (columnIndex) {
      case 0: // name列：文字列のトリミングのみ
        return normalized;
          
      case 2: // category列：カテゴリー正規化
        return normalizeCategory(normalized).toString();
          
      case 3: // added_at列：詳細な日時フォーマット正規化（JST固定）
        if (this.isDateLike(normalized)) {
          try {
            const date = new Date(normalized);
            if (!isNaN(date.getTime())) {
              // JST固定でYYYY-MM-DD HH:mm:ss形式に変換
              const jstOffset = 9 * 60; // JST is UTC+9
              const jstDate = new Date(date.getTime() + (jstOffset * 60 * 1000));
              const year = jstDate.getUTCFullYear();
              const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
              const day = String(jstDate.getUTCDate()).padStart(2, '0');
              const hours = String(jstDate.getUTCHours()).padStart(2, '0');
              const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
              const seconds = String(jstDate.getUTCSeconds()).padStart(2, '0');
              return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            }
          } catch {
            // 日付変換に失敗した場合は元の値をそのまま返す
          }
        }
        return normalized;
      
      case 4: // until列：詳細な日時フォーマット正規化（JST固定）
        if (this.isDateLike(normalized)) {
          try {
            const date = new Date(normalized);
            if (!isNaN(date.getTime())) {
              // JST固定でYYYY-MM-DD HH:mm:ss形式に変換
              const jstOffset = 9 * 60; // JST is UTC+9
              const jstDate = new Date(date.getTime() + (jstOffset * 60 * 1000));
              const year = jstDate.getUTCFullYear();
              const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
              const day = String(jstDate.getUTCDate()).padStart(2, '0');
              const hours = String(jstDate.getUTCHours()).padStart(2, '0');
              const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
              const seconds = String(jstDate.getUTCSeconds()).padStart(2, '0');
              return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            }
          } catch {
            // 日付変換に失敗した場合は元の値をそのまま返す
          }
        }
        return normalized;
          
      default:
        return normalized;
      }
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

    // デバッグ情報
    console.log('normalizePrivateKey - input characteristics:', {
      length: privateKey.length,
      hasBeginHeader: privateKey.includes('-----BEGIN'),
      hasEndFooter: privateKey.includes('-----END'),
      firstChars: privateKey.substring(0, 100),
      lastChars: privateKey.substring(privateKey.length - 100),
      hasEscapedNewlines: privateKey.includes('\\n'),
      hasActualNewlines: privateKey.includes('\n'),
      hasLiteralNewlines: privateKey.includes('\n')
    });

    // 複数の形式に対応した改行文字の正規化
    let normalizedKey = privateKey;
    
    // リテラルの改行文字列 "\n" を実際の改行に変換
    if (normalizedKey.includes('\\n')) {
      normalizedKey = normalizedKey.replace(/\\n/g, '\n');
      console.log('normalizePrivateKey - replaced escaped newlines');
    }
    
    // 既にPEMヘッダー/フッターがある場合
    if (normalizedKey.includes('-----BEGIN') && normalizedKey.includes('-----END')) {
      console.log('normalizePrivateKey - already has PEM headers');
      return normalizedKey;
    }

    // PEMヘッダー/フッターがない場合
    let cleanKey = normalizedKey.trim();
    
    // RSA形式かEC形式かを判定
    const isRSAKey = cleanKey.includes('-----BEGIN RSA PRIVATE KEY-----');
    
    // Base64の改行を処理（64文字ごとに改行が必要）
    if (!cleanKey.includes('\n') && cleanKey.length > 64) {
      console.log('normalizePrivateKey - adding line breaks to Base64 key');
      const chunks = [];
      for (let i = 0; i < cleanKey.length; i += 64) {
        chunks.push(cleanKey.substring(i, i + 64));
      }
      cleanKey = chunks.join('\n');
    }

    // 適切なヘッダー/フッターを追加
    const pemKey = isRSAKey 
      ? cleanKey // RSAキーの場合はすでにヘッダーがあるはず
      : `-----BEGIN PRIVATE KEY-----\n${cleanKey}\n-----END PRIVATE KEY-----`;
    
    console.log('normalizePrivateKey - final key format:', {
      hasHeaders: pemKey.includes('-----BEGIN'),
      keyPreview: pemKey.substring(0, 100) + '...'
    });
    
    return pemKey;
  }
}