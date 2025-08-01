import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction } from 'discord.js';
import { Logger } from '../../src/utils/logger';
import { EditListButtonHandler } from '../../src/buttons/EditListButtonHandler';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import { ButtonHandlerContext } from '../../src/base/BaseButtonHandler';
import { OperationInfo } from '../../src/models/types/OperationLog';

describe('EditListButtonHandler', () => {
  let handler: EditListButtonHandler;
  let logger: Logger;
  let mockGoogleSheetsService: GoogleSheetsService;
  let mockInteraction: ButtonInteraction;
  let context: ButtonHandlerContext;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as any;

    mockGoogleSheetsService = {
      getSheetData: vi.fn()
    } as any;

    mockInteraction = {
      customId: 'edit-list-button',
      user: {
        id: 'user123',
        bot: false
      },
      channelId: 'channel789',
      showModal: vi.fn()
    } as any;

    context = {
      interaction: mockInteraction
    };

    handler = new EditListButtonHandler(logger, undefined, undefined, mockGoogleSheetsService);
  });

  describe('executeAction', () => {
    it('should show modal with empty list data when no sheet data exists', async () => {
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue([]);

      await handler['executeAction'](context);

      expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalledWith('channel789');
      expect(mockInteraction.showModal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            custom_id: 'edit-list-modal',
            title: 'リスト編集'
          })
        })
      );
    });

    it('should show modal with label mentioning completion column', async () => {
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue([]);

      await handler['executeAction'](context);

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      expect(textInput.data.label).toContain('完了');
    });

    it('should show modal with placeholder showing completion column format', async () => {
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue([]);

      await handler['executeAction'](context);

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      expect(textInput.data.placeholder).toContain('空文字');
      expect(textInput.data.placeholder).toContain('1');
    });

    it('should show modal with existing list data in CSV format', async () => {
      const sheetData = [
        ['name', 'category', 'until'],
        ['牛乳', '食品', ''],
        ['パン', '食品', '']
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);

      await handler['executeAction'](context);

      expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalledWith('channel789');
      expect(mockInteraction.showModal).toHaveBeenCalled();

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      expect(textInput.data.value).toBe('牛乳,食品,,\nパン,食品,,');
    });

    it('should skip header row when converting to CSV', async () => {
      const sheetData = [
        ['名前', 'カテゴリ'],
        ['牛乳', '食品']
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);

      await handler['executeAction'](context);

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      expect(textInput.data.value).toBe('牛乳,食品,,');
    });

    it('should skip duplicate names', async () => {
      const sheetData = [
        ['牛乳', '食品'],
        ['牛乳', '食品'], // 重複
        ['パン', '食品']
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);

      await handler['executeAction'](context);

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      expect(textInput.data.value).toBe('牛乳,食品,,\nパン,食品,,');
      expect(logger.warn).toHaveBeenCalledWith(
        'Duplicate name found, skipping',
        expect.objectContaining({ name: '牛乳' })
      );
    });

    it('should handle invalid rows gracefully', async () => {
      const sheetData = [
        ['牛乳', '食品'],
        ['', '食品'], // 空の名前
        ['パン'], // 1列のみのデータ（nameのみ）
        ['シャンプー', '日用品']
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);

      await handler['executeAction'](context);

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      expect(textInput.data.value).toBe('牛乳,食品,,\nパン,,,\nシャンプー,日用品,,');
    });

    it('should preserve empty categories without converting to "その他"', async () => {
      const sheetData = [
        ['name', 'category', 'until'], // ヘッダー行
        ['牛乳', '', ''], // カテゴリが空
        ['パン', '  ', ''], // カテゴリが空白のみ
        ['卵', '食材', ''] // カテゴリあり
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);

      await handler['executeAction'](context);

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      // カテゴリが空の場合は空のままCSVに変換される
      expect(textInput.data.value).toBe('牛乳,,,\nパン,,,\n卵,食材,,');
    });

    it('should return error result when channelId is missing', async () => {
      mockInteraction.channelId = null;

      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.message).toBe('チャンネルIDが取得できません');
      expect(result.error).toBeInstanceOf(Error);
    });

    it('should handle completion data from Google Sheets correctly', async () => {
      const sheetData = [
        ['名前', 'カテゴリ', '期限', '完了'],
        ['牛乳', '食品', '', '1'], // 完了済み
        ['パン', '食品', '', ''], // 未完了（空文字）
        ['卵', '食品', '', '0'], // 未完了（0のレガシー形式）    
        ['シャンプー', '日用品', '', 'その他'] // 未完了（1以外の値）
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);

      await handler['executeAction'](context);

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      // 完了列: "1"のみ完了、それ以外は空文字で表示
      expect(textInput.data.value).toBe('牛乳,食品,,1\nパン,食品,,\n卵,食品,,\nシャンプー,日用品,,');
    });
  });

  describe('convertToListItems', () => {
    it('should preserve empty categories without converting to "その他"', () => {
      const sheetData = [
        ['牛乳', '', '2023-01-01T00:00:00.000Z', ''],
        ['パン', '  ', '2023-01-02T00:00:00.000Z', ''],
        ['卵', '食材', '2023-01-03T00:00:00.000Z', '']
      ];

      const result = handler['convertToListItems'](sheetData);

      expect(result).toHaveLength(3);
      expect(result[0].category).toBe(''); // 空文字列のまま
      expect(result[1].category).toBe(''); // 空白のみの場合も空文字列
      expect(result[2].category).toBe('食材'); // 明示的に指定されたカテゴリ
    });

    it('should parse completion column correctly', () => {
      const sheetData = [
        ['牛乳', '食品', '', '1'], // 完了済み（"1"）
        ['パン', '食品', '', ''], // 未完了（空文字）
        ['卵', '食品', '', '0'], // 未完了（0のレガシー形式）
        ['肉', '食品', '', 'false'], // 未完了（その他の値）
        ['米', '食品', ''] // 完了列なし
      ];

      const result = handler['convertToListItems'](sheetData);

      expect(result).toHaveLength(5);
      expect(result[0].check).toBe(true);  // "1" → true
      expect(result[1].check).toBe(false); // 空文字 → false
      expect(result[2].check).toBe(false); // "0" → false
      expect(result[3].check).toBe(false); // その他の値 → false
      expect(result[4].check).toBe(false); // 完了列なし → false
    });
  });

  describe('convertToCsvText', () => {
    it('should return placeholder text for empty list with completion column', () => {
      const result = handler['convertToCsvText']([]);
      expect(result).toBe('名前,カテゴリ,期限,完了\n例: 牛乳,食品,2024-12-31,');
    });

    it('should convert list items to CSV format with completion column', () => {
      const items = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null,
          check: false
        },
        {
          name: 'パン',
          category: '食品' as any,
          until: null,
          check: true
        }
      ];

      const result = handler['convertToCsvText'](items);
      expect(result).toBe('牛乳,食品,,\nパン,食品,,1');
    });

    it('should convert list items with null values to CSV format with completion column', () => {
      const items = [
        {
          name: 'ミニマルアイテム',
          category: null,
          until: null,
          check: false
        }
      ];

      const result = handler['convertToCsvText'](items);
      expect(result).toBe('ミニマルアイテム,,,');
    });

    it('should convert list items with until date to CSV format with completion column', () => {
      const items = [
        {
          name: '期限テスト',
          category: 'テスト' as any,
          until: new Date('2024-12-31'),
          check: true
        }
      ];

      const result = handler['convertToCsvText'](items);
      expect(result).toBe('期限テスト,テスト,2024-12-31,1');
    });

    it('should handle mixed completion status in CSV format', () => {
      const items = [
        {
          name: '完了アイテム',
          category: 'テスト' as any,
          until: null,
          check: true
        },
        {
          name: '未完了アイテム1',
          category: 'テスト' as any,
          until: null,
          check: false
        },
        {
          name: '未完了アイテム2',
          category: 'テスト' as any,
          until: null,
          check: false
        }
      ];

      const result = handler['convertToCsvText'](items);
      expect(result).toBe('完了アイテム,テスト,,1\n未完了アイテム1,テスト,,\n未完了アイテム2,テスト,,');
    });
  });

  describe('isHeaderRow', () => {
    it('should detect header rows', () => {
      expect(handler['isHeaderRow'](['name', 'category'])).toBe(true);
      expect(handler['isHeaderRow'](['名前', 'カテゴリ'])).toBe(true);
      expect(handler['isHeaderRow'](['Name', 'Category'])).toBe(true);
    });

    it('should not detect data rows as headers', () => {
      expect(handler['isHeaderRow'](['牛乳', '食品'])).toBe(false);
      expect(handler['isHeaderRow'](['パン', '食品'])).toBe(false);
    });
  });

  describe('parseDate', () => {
    it('should parse valid date strings', () => {
      const result = handler['parseDate']('2023-01-01T00:00:00.000Z');
      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBe(new Date('2023-01-01T00:00:00.000Z').getTime());
    });

    it('should return null for invalid date strings', () => {
      expect(handler['parseDate']('invalid-date')).toBe(null);
      expect(handler['parseDate']('')).toBe(null);
    });
  });

  describe('formatDateForCsv', () => {
    it('should format date in YYYY-MM-DD format', () => {
      const date = new Date('2024-12-31T12:00:00.000Z');
      const result = handler['formatDateForCsv'](date);
      expect(result).toBe('2024-12-31');
    });

    it('should format date without timezone shift when date is parsed from YYYY/MM/DD format', () => {
      // スプレッドシートに「2025/07/24」として入力された日付をシミュレート
      const date = new Date('2025/07/24');
      const result = handler['formatDateForCsv'](date);
      expect(result).toBe('2025-07-24'); // 1日前にならないことを確認
    });
  });

  describe('getOperationInfo', () => {
    it('should return operation info for item editing', () => {
      const operationInfo: OperationInfo = handler.getOperationInfo();
      
      expect(operationInfo).toEqual({
        operationType: 'edit',
        actionName: 'アイテム編集'
      });
    });
  });

  describe('executeAction with operation logging', () => {
    it('should return OperationResult when modal is shown', async () => {
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue([]);
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBe('編集モーダルを表示しました');
    });

    it('should include change details for completion status change', async () => {
      const beforeData = [
        ['名前', 'カテゴリ', '期限', '完了'],
        ['牛乳', '食品', '', '']
      ];
      const _afterData = [
        ['名前', 'カテゴリ', '期限', '完了'],
        ['牛乳', '食品', '', '1']
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(beforeData);
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      // const expectedDetails: OperationDetails = {
      //   changes: {
      //     before: { '牛乳': { completed: false } },
      //     after: { '牛乳': { completed: true } }
      //   }
      // };
      
      // 今後の実装で完了状態変更の詳細が記録されることを期待
      expect(result.details?.changes).toBeDefined();
    });

    it('should include multiple item changes in operation details', async () => {
      const sheetData = [
        ['名前', 'カテゴリ', '期限', '完了'],
        ['牛乳', '食品', '', ''],
        ['パン', '食品', '', '1']
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.affectedItems).toBe(2);
      expect(result.details?.items).toHaveLength(2);
    });

    it('should handle Google Sheets service error', async () => {
      const mockError = new Error('Google Sheets API error');
      mockGoogleSheetsService.getSheetData = vi.fn().mockRejectedValue(mockError);
      
      const result = await handler['executeAction'](context);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBe(mockError);
      expect(result.message).toBe('データ取得に失敗しました');
    });
  });
});