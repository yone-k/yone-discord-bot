import { GoogleSheetsService, OperationResult } from './GoogleSheetsService';
import { ChannelMetadata, validateChannelMetadata, updateSyncTime } from '../models/ChannelMetadata';
import { DEFAULT_CATEGORY } from '../models/CategoryType';

export enum MetadataManagerErrorType {
  SHEET_NOT_FOUND = 'SHEET_NOT_FOUND',
  CREATION_FAILED = 'CREATION_FAILED',
  ACCESS_DENIED = 'ACCESS_DENIED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  OPERATION_FAILED = 'OPERATION_FAILED',
  DATA_NOT_FOUND = 'DATA_NOT_FOUND'
}

export class MetadataManagerError extends Error {
  public readonly type: MetadataManagerErrorType;
  public readonly userMessage: string;
  public readonly originalError?: Error;

  constructor(
    type: MetadataManagerErrorType,
    message: string,
    userMessage?: string,
    originalError?: Error
  ) {
    super(message);
    this.name = 'MetadataManagerError';
    this.type = type;
    this.userMessage = userMessage || this.getDefaultUserMessage(type);
    this.originalError = originalError;
  }

  private getDefaultUserMessage(type: MetadataManagerErrorType): string {
    switch (type) {
    case MetadataManagerErrorType.SHEET_NOT_FOUND:
      return 'metadataシートが見つかりません。';
    case MetadataManagerErrorType.CREATION_FAILED:
      return 'metadataシートの作成に失敗しました。';
    case MetadataManagerErrorType.ACCESS_DENIED:
      return 'metadataシートへのアクセス権限がありません。';
    case MetadataManagerErrorType.VALIDATION_FAILED:
      return 'メタデータの形式が正しくありません。';
    case MetadataManagerErrorType.OPERATION_FAILED:
      return 'メタデータ操作に失敗しました。';
    case MetadataManagerErrorType.DATA_NOT_FOUND:
      return 'チャンネルのメタデータが見つかりません。';
    default:
      return '予期しないエラーが発生しました。';
    }
  }
}

export interface MetadataOperationResult {
  success: boolean;
  metadata?: ChannelMetadata;
  message?: string;
}

export class MetadataManager {
  private static instance: MetadataManager | undefined;
  private googleSheetsService: GoogleSheetsService;
  private readonly METADATA_SHEET_NAME = 'metadata';
  private readonly metadataHeaders = ['channel_id', 'message_id', 'list_title', 'last_sync_time', 'default_category', 'operation_log_thread_id'];
  private isInitialized = false;
  private initializationPromise: Promise<OperationResult> | null = null;
  private cachedSheetData: string[][] | null = null;
  private lastCacheTime: number = 0;
  private readonly CACHE_DURATION = 5000; // 5秒間キャッシュを保持

  private constructor() {
    this.googleSheetsService = GoogleSheetsService.getInstance();
  }

  public static getInstance(): MetadataManager {
    if (!MetadataManager.instance) {
      MetadataManager.instance = new MetadataManager();
    }
    return MetadataManager.instance;
  }

  /**
   * キャッシュ機能付きでmetadataシートのデータを取得
   */
  private async getCachedSheetData(forceRefresh = false): Promise<string[][]> {
    const now = Date.now();
    
    // キャッシュが有効かつ強制更新でない場合はキャッシュを返す
    if (!forceRefresh && this.cachedSheetData && (now - this.lastCacheTime) < this.CACHE_DURATION) {
      return this.cachedSheetData;
    }
    
    // APIからデータを取得してキャッシュを更新
    try {
      this.cachedSheetData = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
      this.lastCacheTime = now;
      return this.cachedSheetData;
    } catch (error) {
      // エラーの場合、キャッシュがあればそれを返す
      if (this.cachedSheetData) {
        return this.cachedSheetData;
      }
      throw error;
    }
  }

  /**
   * キャッシュを無効化
   */
  private invalidateCache(): void {
    this.cachedSheetData = null;
    this.lastCacheTime = 0;
  }

  /**
   * データからヘッダーの状態をチェック
   */
  private checkHeaderFromData(data: string[][]): { exists: boolean; isComplete: boolean } {
    if (data.length === 0) {
      return { exists: false, isComplete: false };
    }
    
    const firstRow = data[0];
    
    // 最低限必要なヘッダー（最初の4列）が存在することを確認
    const requiredHeaders = ['channel_id', 'message_id', 'list_title', 'last_sync_time'];
    if (firstRow.length < requiredHeaders.length) {
      return { exists: false, isComplete: false };
    }
    
    // 必須ヘッダーの一致確認
    let hasRequiredHeaders = true;
    for (let i = 0; i < requiredHeaders.length; i++) {
      if (firstRow[i] !== requiredHeaders[i]) {
        hasRequiredHeaders = false;
        break;
      }
    }
    
    if (!hasRequiredHeaders) {
      return { exists: false, isComplete: false };
    }
    
    // 完全性チェック
    const isComplete = firstRow.length === this.metadataHeaders.length &&
                      this.metadataHeaders.every((header, index) => firstRow[index] === header);
    
    return { exists: true, isComplete };
  }


  /**
   * metadataシートを作成（ヘッダー行付き）
   */
  public async createMetadataSheet(): Promise<OperationResult> {
    try {
      // シートを作成
      const createResult = await this.googleSheetsService.createChannelSheet(this.METADATA_SHEET_NAME);
      
      if (!createResult.success) {
        return createResult;
      }

      // ヘッダー行を追加（太字フォーマット付き）
      const headerResult = await this.googleSheetsService.appendSheetData(
        this.METADATA_SHEET_NAME, 
        [this.metadataHeaders], 
        true
      );
      
      if (!headerResult.success) {
        return headerResult;
      }

      return { success: true, sheetId: createResult.sheetId };
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to create metadata sheet: ${(error as Error).message}` 
      };
    }
  }

  /**
   * metadataシートを取得または作成
   */
  public async getOrCreateMetadataSheet(): Promise<OperationResult> {
    // 既に初期化済みの場合は即座に成功を返す
    if (this.isInitialized) {
      return { success: true };
    }

    // 初期化中の場合は既存の初期化プロセスを待つ
    if (this.initializationPromise) {
      return await this.initializationPromise;
    }

    // 新規初期化プロセスを開始
    this.initializationPromise = this.performInitialization();
    return await this.initializationPromise;
  }

  /**
   * 実際の初期化処理を実行（最適化版）
   */
  private async performInitialization(): Promise<OperationResult> {
    try {
      let sheetData: string[][];
      
      // ステップ1: シートの存在確認とデータ取得を同時実行
      try {
        sheetData = await this.getCachedSheetData(true); // 初期化時は強制更新
      } catch (_error) {
        // シートが存在しない場合は新規作成
        const createSheetResult = await this.googleSheetsService.createChannelSheet(this.METADATA_SHEET_NAME);
        if (!createSheetResult.success) {
          throw new MetadataManagerError(
            MetadataManagerErrorType.CREATION_FAILED,
            `Failed to create metadata sheet: ${createSheetResult.message}`
          );
        }
        
        // 作成後にキャッシュを更新
        sheetData = await this.getCachedSheetData(true);
      }

      // ステップ2: 取得したデータを使ってヘッダーチェック
      const hasValidHeader = this.checkHeaderFromData(sheetData);
      
      if (!hasValidHeader.exists) {
        // ヘッダーが全く存在しない場合は新規作成
        const headerResult = await this.googleSheetsService.appendSheetData(
          this.METADATA_SHEET_NAME, 
          [this.metadataHeaders], 
          true
        );
        
        if (!headerResult.success) {
          throw new MetadataManagerError(
            MetadataManagerErrorType.CREATION_FAILED,
            `Failed to create metadata headers: ${headerResult.message}`
          );
        }
        
        // ヘッダー追加後にキャッシュを無効化
        this.invalidateCache();
      } else if (!hasValidHeader.isComplete) {
        // ヘッダーが不完全な場合は更新
        const updateResult = await this.updateMetadataHeaders();
        if (!updateResult.success) {
          throw new MetadataManagerError(
            MetadataManagerErrorType.OPERATION_FAILED,
            `Failed to update metadata headers: ${updateResult.message}`
          );
        }
        
        // ヘッダー更新後にキャッシュを無効化
        this.invalidateCache();
      }

      // 初期化完了をマーク
      this.isInitialized = true;
      this.initializationPromise = null;
      
      return { success: true };
    } catch (error) {
      // 初期化失敗時はプロミスをクリア
      this.initializationPromise = null;
      
      if (error instanceof MetadataManagerError) {
        throw error;
      }
      throw new MetadataManagerError(
        MetadataManagerErrorType.OPERATION_FAILED,
        `Failed to get or create metadata sheet: ${(error as Error).message}`
      );
    }
  }

  /**
   * チャンネルメタデータを取得
   */
  public async getChannelMetadata(channelId: string): Promise<MetadataOperationResult> {
    try {
      // metadataシートの存在確認・作成
      const sheetResult = await this.getOrCreateMetadataSheet();
      if (!sheetResult.success) {
        return {
          success: false,
          message: sheetResult.message
        };
      }

      // metadataシートからデータを取得（キャッシュを使用）
      const data = await this.getCachedSheetData();
      
      // ヘッダー行をスキップして検索
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row[0] === channelId) {
          // データを見つけた場合、ChannelMetadataオブジェクトに変換
          const metadata: ChannelMetadata = {
            channelId: row[0],
            messageId: row[1] || '',
            listTitle: row[2] || '',
            lastSyncTime: this.parseDate(row[3]),
            defaultCategory: row[4] || DEFAULT_CATEGORY,
            operationLogThreadId: row[5] && row[5].trim() !== '' ? row[5] : undefined
          };
          
          return {
            success: true,
            metadata
          };
        }
      }

      // データが見つからない場合
      return {
        success: false,
        message: 'チャンネルのメタデータが見つかりません'
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to get channel metadata: ${(error as Error).message}`
      };
    }
  }

  /**
   * すべてのチャンネルメタデータを取得
   */
  public async listChannelMetadata(): Promise<ChannelMetadata[]> {
    try {
      const sheetResult = await this.getOrCreateMetadataSheet();
      if (!sheetResult.success) {
        return [];
      }

      const data = await this.getCachedSheetData();
      if (data.length <= 1) {
        return [];
      }

      return data.slice(1).map(row => ({
        channelId: row[0],
        messageId: row[1] || '',
        listTitle: row[2] || '',
        lastSyncTime: this.parseDate(row[3]),
        defaultCategory: row[4] || DEFAULT_CATEGORY,
        operationLogThreadId: row[5] && row[5].trim() !== '' ? row[5] : undefined
      })).filter(metadata => metadata.channelId && metadata.channelId.trim() !== '');
    } catch {
      return [];
    }
  }

  /**
   * チャンネルメタデータを更新
   */
  public async updateChannelMetadata(
    channelId: string, 
    metadata: ChannelMetadata
  ): Promise<MetadataOperationResult> {
    try {
      // バリデーション
      validateChannelMetadata(metadata);

      // 同期時間を更新
      const updatedMetadata = updateSyncTime(metadata);

      // metadataシートの存在確認・作成
      const sheetResult = await this.getOrCreateMetadataSheet();
      if (!sheetResult.success) {
        return {
          success: false,
          message: sheetResult.message
        };
      }

      // 既存データの検索と更新（キャッシュを使用）
      const data = await this.getCachedSheetData();
      
      // 更新対象行を検索
      let targetRowIndex = -1;
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === channelId) {
          targetRowIndex = i;
          break;
        }
      }

      if (targetRowIndex === -1) {
        return {
          success: false,
          message: '更新対象のメタデータが見つかりません'
        };
      }

      // データを更新形式に変換
      const updateRow = [
        updatedMetadata.channelId,
        updatedMetadata.messageId,
        updatedMetadata.listTitle,
        this.formatDate(updatedMetadata.lastSyncTime),
        updatedMetadata.defaultCategory,
        updatedMetadata.operationLogThreadId || ''
      ];

      // 特定行のみを更新（行番号は1-based、targetRowIndexは0-basedなので+1）
      const rowNumber = targetRowIndex + 1;
      const updateResult = await this.googleSheetsService.updateSheetData(
        this.METADATA_SHEET_NAME,
        [updateRow],
        `A${rowNumber}:F${rowNumber}`
      );
      
      if (!updateResult.success) {
        return {
          success: false,
          message: updateResult.message
        };
      }

      // 更新成功後にキャッシュを無効化
      this.invalidateCache();

      return {
        success: true,
        metadata: updatedMetadata
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update channel metadata: ${(error as Error).message}`
      };
    }
  }

  /**
   * チャンネルメタデータを作成（atomic操作でrace condition対策）
   */
  public async createChannelMetadata(
    channelId: string, 
    metadata: ChannelMetadata
  ): Promise<MetadataOperationResult> {
    try {
      // バリデーション
      validateChannelMetadata(metadata);

      // 同期時間を設定
      const newMetadata = updateSyncTime(metadata);

      // metadataシートの存在確認・作成
      const sheetResult = await this.getOrCreateMetadataSheet();
      if (!sheetResult.success) {
        return {
          success: false,
          message: sheetResult.message
        };
      }

      // データを追加形式に変換
      const newRow = [
        newMetadata.channelId,
        newMetadata.messageId,
        newMetadata.listTitle,
        this.formatDate(newMetadata.lastSyncTime),
        newMetadata.defaultCategory,
        newMetadata.operationLogThreadId || ''
      ];

      // atomic操作でデータを追加（重複チェックと追加を同時実行）
      const appendResult = await this.googleSheetsService.appendSheetDataWithDuplicateCheck(
        this.METADATA_SHEET_NAME, 
        [newRow],
        0 // channelIdの列でチェック
      );
      
      if (!appendResult.success) {
        // 重複エラーの場合は更新処理に移行（再帰を避けて直接データベース操作）
        if (appendResult.message?.includes('重複データが検出されました')) {
          // 直接更新処理を実行（getChannelMetadata の再帰呼び出しを回避）
          return await this.updateChannelMetadataDirectly(channelId, newMetadata);
        }
        return {
          success: false,
          message: appendResult.message
        };
      }

      // 作成成功後にキャッシュを無効化
      this.invalidateCache();

      return {
        success: true,
        metadata: newMetadata
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create channel metadata: ${(error as Error).message}`
      };
    }
  }

  /**
   * チャンネルメタデータを直接更新（再帰呼び出しを回避）
   */
  private async updateChannelMetadataDirectly(
    channelId: string, 
    metadata: ChannelMetadata
  ): Promise<MetadataOperationResult> {
    try {
      // バリデーション
      validateChannelMetadata(metadata);

      // 同期時間を更新
      const updatedMetadata = updateSyncTime(metadata);

      // metadataシートから直接データを取得（キャッシュを使用、getChannelMetadataを使わない）
      const data = await this.getCachedSheetData();
      
      // 更新対象行を検索
      let targetRowIndex = -1;
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === channelId) {
          targetRowIndex = i;
          break;
        }
      }

      if (targetRowIndex === -1) {
        return {
          success: false,
          message: '更新対象のメタデータが見つかりません'
        };
      }

      // データを更新形式に変換
      const updateRow = [
        updatedMetadata.channelId,
        updatedMetadata.messageId,
        updatedMetadata.listTitle,
        this.formatDate(updatedMetadata.lastSyncTime),
        updatedMetadata.defaultCategory,
        updatedMetadata.operationLogThreadId || ''
      ];

      // 特定行のみを更新（行番号は1-based、targetRowIndexは0-basedなので+1）
      const rowNumber = targetRowIndex + 1;
      const updateResult = await this.googleSheetsService.updateSheetData(
        this.METADATA_SHEET_NAME,
        [updateRow],
        `A${rowNumber}:F${rowNumber}`
      );
      
      if (!updateResult.success) {
        return {
          success: false,
          message: updateResult.message
        };
      }

      // 更新成功後にキャッシュを無効化
      this.invalidateCache();

      return {
        success: true,
        metadata: updatedMetadata
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update channel metadata directly: ${(error as Error).message}`
      };
    }
  }



  /**
   * metadataシートのヘッダーを更新（既存データを保持）
   */
  private async updateMetadataHeaders(): Promise<OperationResult> {
    try {
      // 現在のシートデータを取得（キャッシュを使用）
      const currentData = await this.getCachedSheetData();
      
      if (currentData.length === 0) {
        // データが空の場合は新規作成
        const result = await this.googleSheetsService.appendSheetData(
          this.METADATA_SHEET_NAME,
          [this.metadataHeaders],
          true
        );
        
        if (result.success) {
          this.invalidateCache();
        }
        
        return result;
      }
      
      // 既存のヘッダー行を更新
      const updateResult = await this.googleSheetsService.updateSheetData(
        this.METADATA_SHEET_NAME,
        [this.metadataHeaders],
        'A1:F1'
      );
      
      if (updateResult.success) {
        this.invalidateCache();
      }
      
      return updateResult;
    } catch (error) {
      return {
        success: false,
        message: `Failed to update metadata headers: ${(error as Error).message}`
      };
    }
  }

  /**
   * 日付文字列を解析
   */
  private parseDate(value: string): Date {
    if (!value) {
      return new Date();
    }
    
    const date = new Date(value);
    return isNaN(date.getTime()) ? new Date() : date;
  }

  /**
   * 日付をフォーマット
   */
  private formatDate(date: Date): string {
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
}
