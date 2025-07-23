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
  let mockMetadataManager: any;
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

    mockMetadataManager = {
      getChannelMetadata: vi.fn()
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

    handler = new EditListModalHandler(logger, mockGoogleSheetsService, mockMessageManager, mockMetadataManager);
  });

  describe('executeAction', () => {
    it('should process valid CSV data and update sheets', async () => {
      const csvText = '牛乳,食品\nパン,食品';
      mockFields.getTextInputValue.mockReturnValue(csvText);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

      await handler['executeAction'](context);

      expect(mockFields.getTextInputValue).toHaveBeenCalledWith('list-data');
      expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
        'channel789',
        expect.arrayContaining([
          ['name', 'category', 'until'],
          expect.arrayContaining(['牛乳', '食品']),
          expect.arrayContaining(['パン', '食品'])
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

    it('should handle empty list input without throwing error', async () => {
      mockFields.getTextInputValue.mockReturnValue('');
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

      // Clientのモックを追加
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            name: 'test-channel'
          })
        }
      };
      mockInteraction.client = mockClient;

      await handler['executeAction'](context);

      // 空のリストでも正常に処理されることを確認
      expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
        'channel789',
        expect.arrayContaining([
          ['name', 'category', 'until'] // ヘッダーのみ
        ])
      );
      expect(logger.info).toHaveBeenCalledWith(
        'List edited successfully',
        expect.objectContaining({
          channelId: 'channel789',
          itemCount: 0,
          userId: 'user123'
        })
      );
    });

    it('should throw error when too many items', async () => {
      const manyItems = Array.from({ length: 101 }, (_, i) => `商品${i},食品`).join('\n');
      mockFields.getTextInputValue.mockReturnValue(manyItems);

      await expect(handler['executeAction'](context)).rejects.toThrow('アイテム数が多すぎます（最大100件）。');
    });

    it('should throw error when sheet update fails', async () => {
      const csvText = '牛乳,食品';
      mockFields.getTextInputValue.mockReturnValue(csvText);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ 
        success: false, 
        message: 'Permission denied' 
      });

      await expect(handler['executeAction'](context)).rejects.toThrow('スプレッドシートの更新に失敗しました: Permission denied');
    });
  });

  describe('parseCsvText', () => {
    it('should return empty array for empty input', () => {
      const result = handler['parseCsvText']('');
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace-only input', () => {
      const result = handler['parseCsvText']('   \n   \n   ');
      expect(result).toEqual([]);
    });

    it('should parse valid CSV text', () => {
      const csvText = '牛乳,食品\nパン,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        name: '牛乳',
        category: '食品'
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        name: 'パン',
        category: '食品'
      }));
    });

    it('should preserve empty categories as null without using defaultCategory', () => {
      const csvText = '牛乳,\nパン,  \n卵,食材';
      const result = handler['parseCsvText'](csvText, '日用品'); // defaultCategoryを渡しても使用しない

      expect(result).toHaveLength(3);
      expect(result[0].category).toBe(null); // 空文字列の場合
      expect(result[1].category).toBe(null); // 空白のみの場合  
      expect(result[2].category).toBe('食材'); // 明示的に指定されている場合
    });

    it('should NOT use metadata defaultCategory for empty category in edit mode', async () => {
      // metadataにdefaultCategoryを設定
      mockMetadataManager.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: {
          channelId: 'channel789',
          messageId: 'test-message-id',
          listTitle: 'Test List',
          listType: 'shopping',
          lastSyncTime: new Date(),
          defaultCategory: '日用品'
        }
      });

      const csvText = '牛乳,\nパン,  \n卵,食材';
      mockFields.getTextInputValue.mockReturnValue(csvText);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

      // Clientのモックを追加
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            name: 'test-channel'
          })
        }
      };
      mockInteraction.client = mockClient;

      // ListFormatterをモックして、渡されたitemsを検証
      const ListFormatterModule = await import('../../src/ui/ListFormatter');
      const formatDataListSpy = vi.spyOn(ListFormatterModule.ListFormatter, 'formatDataList');

      await handler['executeAction'](context);

      // formatDataListに渡されたitemsとdefaultCategoryを検証
      expect(formatDataListSpy).toHaveBeenCalled();
      const [, items, defaultCategory] = formatDataListSpy.mock.calls[0];
      
      // defaultCategoryが正しく渡されていることを確認
      expect(defaultCategory).toBe('日用品');
      
      // 編集時はカテゴリが空のアイテムはdefaultCategoryを使用しない
      expect(items[0].category).toBe(null); // 空文字列の場合はnull
      expect(items[1].category).toBe(null); // 空白のみの場合もnull  
      expect(items[2].category).toBe('食材'); // 明示的に指定されている場合
    });

    it('should parse name-only CSV text', () => {
      const csvText = 'テスト1\nテスト2\nテスト3';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(expect.objectContaining({
        name: 'テスト1',
        category: null
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        name: 'テスト2',
        category: null
      }));
      expect(result[2]).toEqual(expect.objectContaining({
        name: 'テスト3',
        category: null
      }));
    });

    it('should parse CSV with date field', () => {
      const csvText = '牛乳,食品,2024-12-31\nパン,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        name: '牛乳',
        category: '食品',
        until: new Date('2024-12-31')
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        name: 'パン',
        category: '食品',
        until: null
      }));
    });

    it('should skip empty lines and comments', () => {
      const csvText = '牛乳,食品\n\n# コメント\n//別のコメント\nパン,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('牛乳');
      expect(result[1].name).toBe('パン');
    });

    it('should skip header lines', () => {
      const csvText = '商品名,カテゴリ\n牛乳,食品\nパン,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('牛乳');
      expect(result[1].name).toBe('パン');
    });

    it('should skip example lines', () => {
      const csvText = '例: 牛乳,食品\n牛乳,食品\nパン,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('牛乳');
      expect(result[1].name).toBe('パン');
    });

    it('should skip invalid format lines', () => {
      const csvText = '牛乳,食品\n\n,食品\nパン,食品';
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
      const csvText = '牛乳,食品\n単一アイテム\nパン,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('牛乳');
      expect(result[1]).toEqual(expect.objectContaining({
        name: '単一アイテム',
        category: null
      }));
      expect(result[2].name).toBe('パン');
    });

    it('should skip duplicate names', () => {
      const csvText = '牛乳,食品\n牛乳,食品\nパン,食品';
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
      const csvText = '牛乳,食品\n無効なカテゴリ,\nパン,食品';
      const result = handler['parseCsvText'](csvText);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('牛乳');
      expect(result[1].name).toBe('パン');
    });
  });

  describe('isHeaderLine', () => {
    it('should detect header lines', () => {
      expect(handler['isHeaderLine']('商品名,カテゴリ')).toBe(true);
      expect(handler['isHeaderLine']('name,category')).toBe(true);
      expect(handler['isHeaderLine']('Name,Category')).toBe(true);
    });

    it('should not detect data lines as headers', () => {
      expect(handler['isHeaderLine']('牛乳,食品')).toBe(false);
      expect(handler['isHeaderLine']('パン,食品')).toBe(false);
    });
  });

  describe('validateItems', () => {
    it('should pass validation for valid items', () => {
      const items = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null
        }
      ];

      expect(() => handler['validateItems'](items)).not.toThrow();
    });

    it('should pass validation for items with null values', () => {
      const items = [
        {
          name: 'ミニマルアイテム',
          category: null,
          until: null
        }
      ];

      expect(() => handler['validateItems'](items)).not.toThrow();
    });

    it('should pass validation for empty items (empty list is now allowed)', () => {
      expect(() => handler['validateItems']([])).not.toThrow();
    });

    it('should throw error for too many items', () => {
      const items = Array.from({ length: 101 }, (_, i) => ({
        name: `商品${i}`,
        category: '食品' as any,
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
          category: '食品' as any,
          until: null
        },
        {
          name: 'パン',
          category: '食品' as any,
          until: new Date('2023-01-10T00:00:00.000Z')
        }
      ];

      const result = handler['convertItemsToSheetData'](items);

      expect(result).toEqual([
        ['name', 'category', 'until'],
        ['牛乳', '食品', ''],
        ['パン', '食品', '2023-01-10']
      ]);
    });

    it('should convert items with null values to sheet data format', () => {
      const items = [
        {
          name: 'ミニマルアイテム',
          category: null,
          until: null
        }
      ];

      const result = handler['convertItemsToSheetData'](items);

      expect(result).toEqual([
        ['name', 'category', 'until'],
        ['ミニマルアイテム', '', '']
      ]);
    });

    it('should convert date without timezone shift when saving to sheet', () => {
      const items = [
        {
          name: 'テスト商品',
          category: '食品' as any,
          until: new Date('2025/07/24') // スプレッドシートから読み込まれた日付をシミュレート
        }
      ];

      const result = handler['convertItemsToSheetData'](items);

      expect(result).toEqual([
        ['name', 'category', 'until'],
        ['テスト商品', '食品', '2025-07-24'] // 1日前にならないことを確認
      ]);
    });
  });

  describe('getSuccessMessage', () => {
    it('should return success message', () => {
      expect(handler.getSuccessMessage()).toBe('✅ リストが正常に更新されました！');
    });
  });
});