import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction } from 'discord.js';
import { Logger } from '../../src/utils/logger';
import { EditListButtonHandler } from '../../src/buttons/EditListButtonHandler';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import { ButtonHandlerContext } from '../../src/base/BaseButtonHandler';

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

    handler = new EditListButtonHandler(logger, mockGoogleSheetsService);
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

    it('should show modal with existing list data in CSV format', async () => {
      const sheetData = [
        ['name', 'quantity', 'category', 'added_at', 'until'],
        ['牛乳', '1本', '食品', '2023-01-01T00:00:00.000Z', ''],
        ['パン', '2斤', '食品', '2023-01-02T00:00:00.000Z', '']
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);

      await handler['executeAction'](context);

      expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalledWith('channel789');
      expect(mockInteraction.showModal).toHaveBeenCalled();

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      expect(textInput.data.value).toBe('牛乳,1本,食品,\nパン,2斤,食品,');
    });

    it('should skip header row when converting to CSV', async () => {
      const sheetData = [
        ['商品名', '数量', 'カテゴリ'],
        ['牛乳', '1本', '食品']
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);

      await handler['executeAction'](context);

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      expect(textInput.data.value).toBe('牛乳,1本,食品,');
    });

    it('should skip duplicate names', async () => {
      const sheetData = [
        ['牛乳', '1本', '食品'],
        ['牛乳', '2本', '食品'], // 重複
        ['パン', '1斤', '食品']
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);

      await handler['executeAction'](context);

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      expect(textInput.data.value).toBe('牛乳,1本,食品,\nパン,1斤,食品,');
      expect(logger.warn).toHaveBeenCalledWith(
        'Duplicate name found, skipping',
        expect.objectContaining({ name: '牛乳' })
      );
    });

    it('should handle invalid rows gracefully', async () => {
      const sheetData = [
        ['牛乳', '1本', '食品'],
        ['', '2本', '食品'], // 空の名前
        ['パン'], // データ不足
        ['シャンプー', '1個', '日用品']
      ];
      
      mockGoogleSheetsService.getSheetData = vi.fn().mockResolvedValue(sheetData);

      await handler['executeAction'](context);

      const modalCall = mockInteraction.showModal.mock.calls[0][0];
      const textInput = modalCall.components[0].components[0];
      expect(textInput.data.value).toBe('牛乳,1本,食品,\nシャンプー,1個,日用品,');
    });

    it('should throw error when channelId is missing', async () => {
      mockInteraction.channelId = null;

      await expect(handler['executeAction'](context)).rejects.toThrow('チャンネルIDが取得できません');
    });
  });

  describe('convertToCsvText', () => {
    it('should return placeholder text for empty list', () => {
      const result = handler['convertToCsvText']([]);
      expect(result).toBe('商品名,数量,カテゴリ,期限\n例: 牛乳,1本,食品,2024-12-31');
    });

    it('should convert list items to CSV format', () => {
      const items = [
        {
          name: '牛乳',
          quantity: '1本',
          category: '食品' as any,
          addedAt: new Date('2023-01-01'),
          until: null
        },
        {
          name: 'パン',
          quantity: '2斤',
          category: '食品' as any,
          addedAt: new Date('2023-01-02'),
          until: null
        }
      ];

      const result = handler['convertToCsvText'](items);
      expect(result).toBe('牛乳,1本,食品,\nパン,2斤,食品,');
    });

    it('should convert list items with null values to CSV format', () => {
      const items = [
        {
          name: 'ミニマルアイテム',
          quantity: null,
          category: null,
          addedAt: new Date('2023-01-01'),
          until: null
        }
      ];

      const result = handler['convertToCsvText'](items);
      expect(result).toBe('ミニマルアイテム,,,');
    });

    it('should convert list items with until date to CSV format', () => {
      const items = [
        {
          name: '期限テスト',
          quantity: '1個',
          category: 'テスト',
          addedAt: new Date('2023-01-01'),
          until: new Date('2024-12-31')
        }
      ];

      const result = handler['convertToCsvText'](items);
      expect(result).toBe('期限テスト,1個,テスト,2024-12-31');
    });
  });

  describe('isHeaderRow', () => {
    it('should detect header rows', () => {
      expect(handler['isHeaderRow'](['name', 'quantity', 'category'])).toBe(true);
      expect(handler['isHeaderRow'](['商品名', '数量', 'カテゴリ'])).toBe(true);
      expect(handler['isHeaderRow'](['Name', 'Quantity', 'Category'])).toBe(true);
    });

    it('should not detect data rows as headers', () => {
      expect(handler['isHeaderRow'](['牛乳', '1本', '食品'])).toBe(false);
      expect(handler['isHeaderRow'](['パン', '2斤', '食品'])).toBe(false);
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
  });
});