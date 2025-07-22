import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalSubmitInteraction } from 'discord.js';
import { Logger } from '../../src/utils/logger';
import { EditListModalHandler } from '../../src/modals/EditListModalHandler';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import { MessageManager } from '../../src/services/MessageManager';
import { ModalHandlerContext } from '../../src/base/BaseModalHandler';

describe('EditListModalHandler', () => {
  let handler: EditListModalHandler;
  let logger: Logger;
  let mockGoogleSheetsService: GoogleSheetsService;
  let mockMessageManager: MessageManager;
  let mockInteraction: ModalSubmitInteraction;
  let context: ModalHandlerContext;
  let mockFields: any;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as any;

    mockGoogleSheetsService = {
      updateSheetData: vi.fn()
    } as any;

    mockMessageManager = {
      createOrUpdateMessageWithMetadata: vi.fn()
    } as any;

    mockFields = {
      getTextInputValue: vi.fn()
    };

    mockInteraction = {
      customId: 'edit-list-modal',
      user: {
        id: 'user123',
        bot: false
      },
      channelId: 'channel789',
      fields: mockFields
    } as any;

    context = {
      interaction: mockInteraction
    };

    handler = new EditListModalHandler(logger, mockGoogleSheetsService, mockMessageManager);
  });

  describe('executeAction', () => {
    it('should process valid CSV data and update sheets', async () => {
      const csvText = '牛乳,1本,食品\nパン,2斤,食品';
      mockFields.getTextInputValue.mockReturnValue(csvText);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

      await handler['executeAction'](context);

      expect(mockFields.getTextInputValue).toHaveBeenCalledWith('list-data');
      expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
        'channel789',
        expect.arrayContaining([
          ['name', 'quantity', 'category', 'added_at', 'until'],
          expect.arrayContaining(['牛乳', '1本', '食品']),
          expect.arrayContaining(['パン', '2斤', '食品'])
        ])
      );
      expect(logger.info).toHaveBeenCalledWith(
        'List edited successfully',
        expect.objectContaining({
          channelId: 'channel789',
          itemCount: 2,
          userId: 'user123'
        })
      );
    });

    it('should throw error when channelId is missing', async () => {
      mockInteraction.channelId = null;

      await expect(handler['executeAction'](context)).rejects.toThrow('チャンネルIDが取得できません');
    });

    it('should throw error when no valid data found', async () => {
      mockFields.getTextInputValue.mockReturnValue('');

      await expect(handler['executeAction'](context)).rejects.toThrow('有効なデータが見つかりません。正しい形式で入力してください。');
    });

    it('should throw error when too many items', async () => {
      const manyItems = Array.from({ length: 101 }, (_, i) => `商品${i},1個,食品`).join('\n');
      mockFields.getTextInputValue.mockReturnValue(manyItems);

      await expect(handler['executeAction'](context)).rejects.toThrow('アイテム数が多すぎます（最大100件）。');
    });

    it('should throw error when sheet update fails', async () => {
      const csvText = '牛乳,1本,食品';
      mockFields.getTextInputValue.mockReturnValue(csvText);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ 
        success: false, 
        message: 'Permission denied' 
      });

      await expect(handler['executeAction'](context)).rejects.toThrow('スプレッドシートの更新に失敗しました: Permission denied');
    });
  });

  describe('parseCsvText', () => {
    it('should parse valid CSV text', () => {
      const csvText = '牛乳,1本,食品\nパン,2斤,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        name: '牛乳',
        quantity: '1本',
        category: '食品'
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        name: 'パン',
        quantity: '2斤',
        category: '食品'
      }));
    });

    it('should parse name-only CSV text', () => {
      const csvText = 'テスト1\nテスト2\nテスト3';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(expect.objectContaining({
        name: 'テスト1',
        quantity: null,
        category: null
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        name: 'テスト2',
        quantity: null,
        category: null
      }));
      expect(result[2]).toEqual(expect.objectContaining({
        name: 'テスト3',
        quantity: null,
        category: null
      }));
    });

    it('should parse CSV with date field', () => {
      const csvText = '牛乳,1本,食品,2024-12-31\nパン,2斤,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        name: '牛乳',
        quantity: '1本',
        category: '食品',
        until: new Date('2024-12-31')
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        name: 'パン',
        quantity: '2斤',
        category: '食品',
        until: null
      }));
    });

    it('should skip empty lines and comments', () => {
      const csvText = '牛乳,1本,食品\n\n# コメント\n//別のコメント\nパン,2斤,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('牛乳');
      expect(result[1].name).toBe('パン');
    });

    it('should skip header lines', () => {
      const csvText = '商品名,数量,カテゴリ\n牛乳,1本,食品\nパン,2斤,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('牛乳');
      expect(result[1].name).toBe('パン');
    });

    it('should skip example lines', () => {
      const csvText = '例: 牛乳,1本,食品\n牛乳,1本,食品\nパン,2斤,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('牛乳');
      expect(result[1].name).toBe('パン');
    });

    it('should skip invalid format lines', () => {
      const csvText = '牛乳,1本,食品\n\n,空の名前,食品\nパン,2斤,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('牛乳');
      expect(result[1].name).toBe('パン');
      expect(logger.warn).toHaveBeenCalledWith(
        'Empty name found, skipping',
        expect.objectContaining({ lineNumber: 3 })
      );
    });

    it('should accept single field lines as valid', () => {
      const csvText = '牛乳,1本,食品\n単一アイテム\nパン,2斤,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('牛乳');
      expect(result[1]).toEqual(expect.objectContaining({
        name: '単一アイテム',
        quantity: null,
        category: null
      }));
      expect(result[2].name).toBe('パン');
    });

    it('should skip duplicate names', () => {
      const csvText = '牛乳,1本,食品\n牛乳,2本,食品\nパン,2斤,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('牛乳');
      expect(result[1].name).toBe('パン');
      expect(logger.warn).toHaveBeenCalledWith(
        'Duplicate name found, skipping',
        expect.objectContaining({ name: '牛乳' })
      );
    });

    it('should handle parsing errors gracefully', () => {
      const csvText = '牛乳,1本,食品\n無効なカテゴリ,1個,\nパン,2斤,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('牛乳');
      expect(result[1].name).toBe('パン');
    });
  });

  describe('isHeaderLine', () => {
    it('should detect header lines', () => {
      expect(handler['isHeaderLine']('商品名,数量,カテゴリ')).toBe(true);
      expect(handler['isHeaderLine']('name,quantity,category')).toBe(true);
      expect(handler['isHeaderLine']('Name,Quantity,Category')).toBe(true);
    });

    it('should not detect data lines as headers', () => {
      expect(handler['isHeaderLine']('牛乳,1本,食品')).toBe(false);
      expect(handler['isHeaderLine']('パン,2斤,食品')).toBe(false);
    });
  });

  describe('validateItems', () => {
    it('should pass validation for valid items', () => {
      const items = [
        {
          name: '牛乳',
          quantity: '1本',
          category: '食品' as any,
          addedAt: new Date(),
          until: null
        }
      ];

      expect(() => handler['validateItems'](items)).not.toThrow();
    });

    it('should pass validation for items with null values', () => {
      const items = [
        {
          name: 'ミニマルアイテム',
          quantity: null,
          category: null,
          addedAt: new Date(),
          until: null
        }
      ];

      expect(() => handler['validateItems'](items)).not.toThrow();
    });

    it('should throw error for empty items', () => {
      expect(() => handler['validateItems']([])).toThrow('有効なデータが見つかりません。正しい形式で入力してください。');
    });

    it('should throw error for too many items', () => {
      const items = Array.from({ length: 101 }, (_, i) => ({
        name: `商品${i}`,
        quantity: '1個',
        category: '食品' as any,
        addedAt: new Date(),
        until: null
      }));

      expect(() => handler['validateItems'](items)).toThrow('アイテム数が多すぎます（最大100件）。');
    });
  });

  describe('convertItemsToSheetData', () => {
    it('should convert items to sheet data format', () => {
      const items = [
        {
          name: '牛乳',
          quantity: '1本',
          category: '食品' as any,
          addedAt: new Date('2023-01-01T00:00:00.000Z'),
          until: null
        },
        {
          name: 'パン',
          quantity: '2斤',
          category: '食品' as any,
          addedAt: new Date('2023-01-02T00:00:00.000Z'),
          until: new Date('2023-01-10T00:00:00.000Z')
        }
      ];

      const result = handler['convertItemsToSheetData'](items);

      expect(result).toEqual([
        ['name', 'quantity', 'category', 'added_at', 'until'],
        ['牛乳', '1本', '食品', '2023-01-01T00:00:00.000Z', ''],
        ['パン', '2斤', '食品', '2023-01-02T00:00:00.000Z', '2023-01-10T00:00:00.000Z']
      ]);
    });

    it('should convert items with null values to sheet data format', () => {
      const items = [
        {
          name: 'ミニマルアイテム',
          quantity: null,
          category: null,
          addedAt: new Date('2023-01-01T00:00:00.000Z'),
          until: null
        }
      ];

      const result = handler['convertItemsToSheetData'](items);

      expect(result).toEqual([
        ['name', 'quantity', 'category', 'added_at', 'until'],
        ['ミニマルアイテム', '', '', '2023-01-01T00:00:00.000Z', '']
      ]);
    });
  });

  describe('getSuccessMessage', () => {
    it('should return success message', () => {
      expect(handler.getSuccessMessage()).toBe('✅ リストが正常に更新されました！');
    });
  });
});