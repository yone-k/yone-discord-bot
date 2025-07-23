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
  private googleSheetsService: GoogleSheetsService;
  private readonly METADATA_SHEET_NAME = 'metadata';
  private readonly metadataHeaders = ['channel_id', 'message_id', 'list_title', 'last_sync_time', 'default_category'];

  constructor() {
    this.googleSheetsService = GoogleSheetsService.getInstance();
  }

  /**
   * metadataシートの存在確認
   */
  public async metadataSheetExists(): Promise<boolean> {
    try {
      await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * metadataシートのヘッダー存在確認
   */
  public async metadataHeaderExists(): Promise<boolean> {
    try {
      const data = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
      
      if (data.length === 0) {
        return false;
      }
      
      const firstRow = data[0];
      
      // 最低限必要なヘッダー（最初の4列）が存在することを確認
      const requiredHeaders = ['channel_id', 'message_id', 'list_title', 'last_sync_time'];
      if (firstRow.length < requiredHeaders.length) {
        return false;
      }
      
      // 必須ヘッダーの一致確認
      for (let i = 0; i < requiredHeaders.length; i++) {
        if (firstRow[i] !== requiredHeaders[i]) {
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * metadataシートのヘッダーが完全かチェック
   */
  public async isMetadataHeaderComplete(): Promise<boolean> {
    try {
      const data = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
      
      if (data.length === 0) {
        return false;
      }
      
      const firstRow = data[0];
      return firstRow.length === this.metadataHeaders.length &&
             this.metadataHeaders.every((header, index) => firstRow[index] === header);
    } catch {
      return false;
    }
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
    try {
      // ステップ1: シートの存在確認、なければ作成
      const sheetExists = await this.metadataSheetExists();
      
      if (!sheetExists) {
        const createSheetResult = await this.googleSheetsService.createChannelSheet(this.METADATA_SHEET_NAME);
        if (!createSheetResult.success) {
          throw new MetadataManagerError(
            MetadataManagerErrorType.CREATION_FAILED,
            `Failed to create metadata sheet: ${createSheetResult.message}`
          );
        }
      }

      // ステップ2: ヘッダーの存在確認
      const headerExists = await this.metadataHeaderExists();
      
      if (!headerExists) {
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
      } else {
        // ステップ3: ヘッダーが存在する場合、完全性をチェック
        const isComplete = await this.isMetadataHeaderComplete();
        
        if (!isComplete) {
          // ヘッダーが不完全な場合は更新
          const updateResult = await this.updateMetadataHeaders();
          if (!updateResult.success) {
            throw new MetadataManagerError(
              MetadataManagerErrorType.OPERATION_FAILED,
              `Failed to update metadata headers: ${updateResult.message}`
            );
          }
        }
      }

      return { success: true };
    } catch (error) {
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

      // metadataシートからデータを取得
      const data = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
      
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
            defaultCategory: row[4] || DEFAULT_CATEGORY
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

      // 既存データの検索と更新
      const data = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
      
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
        updatedMetadata.defaultCategory
      ];

      // 特定行のみを更新（行番号は1-based、targetRowIndexは0-basedなので+1）
      const rowNumber = targetRowIndex + 1;
      const updateResult = await this.googleSheetsService.updateSheetData(
        this.METADATA_SHEET_NAME,
        [updateRow],
        `A${rowNumber}:E${rowNumber}`
      );
      
      if (!updateResult.success) {
        return {
          success: false,
          message: updateResult.message
        };
      }

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
        newMetadata.defaultCategory
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

      // metadataシートから直接データを取得（getChannelMetadataを使わない）
      const data = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
      
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
        updatedMetadata.defaultCategory
      ];

      // 特定行のみを更新（行番号は1-based、targetRowIndexは0-basedなので+1）
      const rowNumber = targetRowIndex + 1;
      const updateResult = await this.googleSheetsService.updateSheetData(
        this.METADATA_SHEET_NAME,
        [updateRow],
        `A${rowNumber}:E${rowNumber}`
      );
      
      if (!updateResult.success) {
        return {
          success: false,
          message: updateResult.message
        };
      }

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
   * metadataシートをクリア（ヘッダー行は残す）
   */
  private async clearMetadataSheet(): Promise<void> {
    // Google Sheets APIの制限により、シートを削除して再作成
    // 実際の実装では、より効率的な方法が必要な場合があります
    const data = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
    if (data.length <= 1) {
      return; // ヘッダー行のみまたは空の場合はクリア不要
    }
    
    // この実装は簡素化されています。実際にはGoogle Sheets APIのclear機能を使用することが推奨されます。
  }


  /**
   * metadataシートのヘッダーを更新（既存データを保持）
   */
  private async updateMetadataHeaders(): Promise<OperationResult> {
    try {
      // 現在のシートデータを取得
      const currentData = await this.googleSheetsService.getSheetDataByName(this.METADATA_SHEET_NAME);
      
      if (currentData.length === 0) {
        // データが空の場合は新規作成
        return await this.googleSheetsService.appendSheetData(
          this.METADATA_SHEET_NAME,
          [this.metadataHeaders],
          true
        );
      }
      
      // 既存のヘッダー行を更新
      const updateResult = await this.googleSheetsService.updateSheetData(
        this.METADATA_SHEET_NAME,
        [this.metadataHeaders],
        'A1:E1'
      );
      
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