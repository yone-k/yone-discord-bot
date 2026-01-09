import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelSheetManager, ChannelSheetError, ChannelSheetErrorType } from '../../src/services/ChannelSheetManager';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';

// GoogleSheetsServiceのモック
vi.mock('../../src/services/GoogleSheetsService');

describe('ChannelSheetManager', () => {
  let mockGoogleSheetsService: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let channelSheetManager: ChannelSheetManager;

  beforeEach(() => {
    // GoogleSheetsServiceのモックを設定
    mockGoogleSheetsService = {
      getSheetNameForChannel: vi.fn(),
      checkSpreadsheetExists: vi.fn(),
      createChannelSheet: vi.fn(),
      getSheetData: vi.fn(),
      appendSheetData: vi.fn(),
      getSheetMetadata: vi.fn(),
      validateData: vi.fn(),
      normalizeData: vi.fn()
    };

    // GoogleSheetsService.getInstanceがモックを返すように設定
    vi.mocked(GoogleSheetsService.getInstance).mockReturnValue(mockGoogleSheetsService);

    channelSheetManager = new ChannelSheetManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('基本機能', () => {
    it('シート命名規則が正しく実装されている', () => {
      const channelId = '123456789';
      const expectedSheetName = 'list_123456789';
      
      mockGoogleSheetsService.getSheetNameForChannel.mockReturnValue(expectedSheetName);
      
      const sheetName = channelSheetManager.getSheetNameForChannel(channelId);
      
      expect(mockGoogleSheetsService.getSheetNameForChannel).toHaveBeenCalledWith(channelId);
      expect(sheetName).toBe(expectedSheetName);
    });

    it('チャンネル専用シートの存在確認ができる', async () => {
      const channelId = '123456789';
      
      mockGoogleSheetsService.getSheetData.mockResolvedValue([['項目名', '説明', '日付']]);
      
      const exists = await channelSheetManager.channelSheetExists(channelId);
      
      expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalledWith(channelId);
      expect(exists).toBe(true);
    });

    it('チャンネル専用シートが存在しない場合はfalseを返す', async () => {
      const channelId = '123456789';
      
      mockGoogleSheetsService.getSheetData.mockResolvedValue([]);
      
      const exists = await channelSheetManager.channelSheetExists(channelId);
      
      expect(exists).toBe(false);
    });

    it('シートアクセス時にエラーが発生した場合はfalseを返す', async () => {
      const channelId = '123456789';
      
      mockGoogleSheetsService.getSheetData.mockRejectedValue(new Error('Sheet not found'));
      
      const exists = await channelSheetManager.channelSheetExists(channelId);
      
      expect(exists).toBe(false);
    });
  });

  describe('シート作成機能', () => {
    it('新規シート作成時にデフォルトヘッダー行が設定される', async () => {
      const channelId = '123456789';
      const expectedHeaders = ['name', 'category', 'until', 'check', 'last_notified_at'];
      
      mockGoogleSheetsService.createChannelSheet.mockResolvedValue({ 
        success: true, 
        sheetId: 123 
      });
      mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });
      
      const result = await channelSheetManager.createChannelSheetWithHeaders(channelId);
      
      expect(mockGoogleSheetsService.createChannelSheet).toHaveBeenCalledWith(channelId);
      expect(mockGoogleSheetsService.appendSheetData).toHaveBeenCalledWith(
        channelId, 
        [expectedHeaders]
      );
      expect(result.success).toBe(true);
    });

    it('カスタムヘッダー行でシートを作成できる', async () => {
      const channelId = '123456789';
      const customHeaders = ['タスク', '担当者', '期限', '優先度'];
      
      mockGoogleSheetsService.createChannelSheet.mockResolvedValue({ 
        success: true, 
        sheetId: 123 
      });
      mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });
      
      const result = await channelSheetManager.createChannelSheetWithHeaders(channelId, customHeaders);
      
      expect(mockGoogleSheetsService.createChannelSheet).toHaveBeenCalledWith(channelId);
      expect(mockGoogleSheetsService.appendSheetData).toHaveBeenCalledWith(
        channelId, 
        [customHeaders]
      );
      expect(result.success).toBe(true);
    });

    it('シート作成に失敗した場合は適切なエラーを返す', async () => {
      const channelId = '123456789';
      
      mockGoogleSheetsService.createChannelSheet.mockResolvedValue({ 
        success: false, 
        message: 'Failed to create sheet' 
      });
      
      const result = await channelSheetManager.createChannelSheetWithHeaders(channelId);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to create sheet');
    });

    it('ヘッダー行の追加に失敗した場合は適切なエラーを返す', async () => {
      const channelId = '123456789';
      
      mockGoogleSheetsService.createChannelSheet.mockResolvedValue({ 
        success: true, 
        sheetId: 123 
      });
      mockGoogleSheetsService.appendSheetData.mockResolvedValue({ 
        success: false, 
        message: 'Failed to add headers' 
      });
      
      const result = await channelSheetManager.createChannelSheetWithHeaders(channelId);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to add headers');
    });
  });

  describe('アクセス権限検証', () => {
    it('シートアクセス権限を検証できる', async () => {
      const channelId = '123456789';
      
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockResolvedValue([['項目名', '説明', '日付']]);
      
      const hasAccess = await channelSheetManager.verifySheetAccess(channelId);
      
      expect(mockGoogleSheetsService.checkSpreadsheetExists).toHaveBeenCalled();
      expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalledWith(channelId);
      expect(hasAccess).toBe(true);
    });

    it('スプレッドシートが存在しない場合はアクセス権限なしと判定する', async () => {
      const channelId = '123456789';
      
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(false);
      
      const hasAccess = await channelSheetManager.verifySheetAccess(channelId);
      
      expect(hasAccess).toBe(false);
    });

    it('シートデータの取得に失敗した場合はアクセス権限なしと判定する', async () => {
      const channelId = '123456789';
      
      mockGoogleSheetsService.checkSpreadsheetExists.mockResolvedValue(true);
      mockGoogleSheetsService.getSheetData.mockRejectedValue(new Error('Permission denied'));
      
      const hasAccess = await channelSheetManager.verifySheetAccess(channelId);
      
      expect(hasAccess).toBe(false);
    });
  });

  describe('高レベル操作', () => {
    it('シートを取得または作成できる（既存シートがある場合）', async () => {
      const channelId = '123456789';
      const existingData = [['項目名', '説明', '日付'], ['テスト項目', 'テスト説明', '2025-01-01']];
      
      mockGoogleSheetsService.getSheetData.mockResolvedValue(existingData);
      
      const result = await channelSheetManager.getOrCreateChannelSheet(channelId);
      
      expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalledWith(channelId);
      expect(result.existed).toBe(true);
      expect(result.data).toEqual(existingData);
    });

    it('シートを取得または作成できる（新規作成の場合）', async () => {
      const channelId = '123456789';
      
      mockGoogleSheetsService.getSheetData.mockResolvedValue([]);
      mockGoogleSheetsService.createChannelSheet.mockResolvedValue({ 
        success: true, 
        sheetId: 123 
      });
      mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });
      
      const result = await channelSheetManager.getOrCreateChannelSheet(channelId);
      
      expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalledWith(channelId);
      expect(mockGoogleSheetsService.createChannelSheet).toHaveBeenCalledWith(channelId);
      expect(mockGoogleSheetsService.appendSheetData).toHaveBeenCalled();
      expect(result.existed).toBe(false);
      expect(result.created).toBe(true);
    });

    it('シート作成に失敗した場合は適切なエラーをスローする', async () => {
      const channelId = '123456789';
      
      mockGoogleSheetsService.getSheetData.mockResolvedValue([]);
      mockGoogleSheetsService.createChannelSheet.mockResolvedValue({ 
        success: false, 
        message: 'Failed to create sheet' 
      });
      
      await expect(channelSheetManager.getOrCreateChannelSheet(channelId))
        .rejects.toThrow(ChannelSheetError);
    });
  });

  describe('データ操作', () => {
    it('チャンネルシートにデータを追加できる', async () => {
      const channelId = '123456789';
      const newData = [['新しい項目', '新しい説明', '2025-01-02', '未完了']];
      
      mockGoogleSheetsService.validateData.mockReturnValue({ 
        isValid: true, 
        errors: [] 
      });
      mockGoogleSheetsService.normalizeData.mockReturnValue(newData);
      mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });
      
      const result = await channelSheetManager.addDataToChannelSheet(channelId, newData);
      
      expect(mockGoogleSheetsService.validateData).toHaveBeenCalledWith(newData);
      expect(mockGoogleSheetsService.normalizeData).toHaveBeenCalledWith(newData);
      expect(mockGoogleSheetsService.appendSheetData).toHaveBeenCalledWith(channelId, newData);
      expect(result.success).toBe(true);
    });

    it('無効なデータの場合は検証エラーを返す', async () => {
      const channelId = '123456789';
      const invalidData = [['', '', '']];
      
      mockGoogleSheetsService.validateData.mockReturnValue({ 
        isValid: false, 
        errors: ['項目名が空です'] 
      });
      
      const result = await channelSheetManager.addDataToChannelSheet(channelId, invalidData);
      
      expect(result.success).toBe(false);
      expect(result.errors).toEqual(['項目名が空です']);
    });
  });

  describe('エラーハンドリング', () => {
    it('ChannelSheetErrorが適切に作成される', () => {
      const error = new ChannelSheetError(
        ChannelSheetErrorType.SHEET_NOT_FOUND,
        'Sheet not found',
        'チャンネル専用のシートが見つかりません。'
      );
      
      expect(error.type).toBe(ChannelSheetErrorType.SHEET_NOT_FOUND);
      expect(error.message).toBe('Sheet not found');
      expect(error.userMessage).toBe('チャンネル専用のシートが見つかりません。');
      expect(error.name).toBe('ChannelSheetError');
    });
  });
});
