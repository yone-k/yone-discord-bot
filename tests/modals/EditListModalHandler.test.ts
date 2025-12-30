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
      getSheetData: vi.fn().mockResolvedValue([]),
      updateSheetData: vi.fn()
    } as any;

    mockMessageManager = {
      createOrUpdateMessageWithMetadataV2: vi.fn()
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
          ['name', 'category', 'until', 'check'],
          expect.arrayContaining(['牛乳', '食品', '', 0]),
          expect.arrayContaining(['パン', '食品', '', 0])
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

    it('should return error result when channelId is missing', async () => {
      mockInteraction.channelId = null;

      const result = await handler['executeAction'](context);
      expect(result.success).toBe(false);
      expect(result.message).toBe('チャンネルIDが取得できません');
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
          ['name', 'category', 'until', 'check'] // ヘッダーのみ
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

    it('should return error result when too many items', async () => {
      const manyItems = Array.from({ length: 101 }, (_, i) => `商品${i},食品`).join('\n');
      mockFields.getTextInputValue.mockReturnValue(manyItems);

      const result = await handler['executeAction'](context);
      expect(result.success).toBe(false);
      expect(result.message).toBe('アイテム数が多すぎます（最大100件）。');
    });

    it('should return error result when sheet update fails', async () => {
      const csvText = '牛乳,食品';
      mockFields.getTextInputValue.mockReturnValue(csvText);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ 
        success: false, 
        message: 'Permission denied' 
      });

      const result = await handler['executeAction'](context);
      expect(result.success).toBe(false);
      expect(result.message).toBe('スプレッドシートの更新に失敗しました: Permission denied');
    });

    it('should process CSV data with completion column', async () => {
      const csvText = '牛乳,食品,2024-12-31,1\nパン,食品,,0';
      mockFields.getTextInputValue.mockReturnValue(csvText);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

      await handler['executeAction'](context);

      expect(mockFields.getTextInputValue).toHaveBeenCalledWith('list-data');
      expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
        'channel789',
        expect.arrayContaining([
          ['name', 'category', 'until', 'check'],
          expect.arrayContaining(['牛乳', '食品', '2024-12-31', 1]),
          expect.arrayContaining(['パン', '食品', '', 0])
        ])
      );
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
      const [, items, channelId, defaultCategory] = formatDataListSpy.mock.calls[0];
      
      // channelIdが正しく渡されていることを確認
      expect(channelId).toBe('channel789');
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
      const csvText = '名前,カテゴリ\n牛乳,食品\nパン,食品';
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
      expect(handler['isHeaderLine']('名前,カテゴリ')).toBe(true);
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
          until: null,
          check: false
        }
      ];

      expect(() => handler['validateItems'](items)).not.toThrow();
    });

    it('should pass validation for items with null values', () => {
      const items = [
        {
          name: 'ミニマルアイテム',
          category: null,
          until: null,
          check: false
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
        until: null,
        check: false
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
          until: null,
          check: false
        },
        {
          name: 'パン',
          category: '食品' as any,
          until: new Date('2023-01-10T00:00:00.000Z'),
          check: false
        }
      ];

      const result = handler['convertItemsToSheetData'](items);

      expect(result).toEqual([
        ['name', 'category', 'until', 'check'],
        ['牛乳', '食品', '', 0],
        ['パン', '食品', '2023-01-10', 0]
      ]);
    });

    it('should convert items with null values to sheet data format', () => {
      const items = [
        {
          name: 'ミニマルアイテム',
          category: null,
          until: null,
          check: false
        }
      ];

      const result = handler['convertItemsToSheetData'](items);

      expect(result).toEqual([
        ['name', 'category', 'until', 'check'],
        ['ミニマルアイテム', '', '', 0]
      ]);
    });

    it('should convert items with completion status to sheet data format', () => {
      const items = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null,
          check: true
        },
        {
          name: 'パン',
          category: '食品' as any,
          until: new Date('2023-01-10T00:00:00.000Z'),
          check: false
        },
        {
          name: '卵',
          category: '食品' as any,
          until: null,
          check: false
        }
      ];

      const result = handler['convertItemsToSheetData'](items);

      expect(result).toEqual([
        ['name', 'category', 'until', 'check'],
        ['牛乳', '食品', '', 1],
        ['パン', '食品', '2023-01-10', 0],
        ['卵', '食品', '', 0]
      ]);
    });

    it('should convert date without timezone shift when saving to sheet', () => {
      const items = [
        {
          name: 'テスト商品',
          category: '食品' as any,
          until: new Date('2025/07/24'), // スプレッドシートから読み込まれた日付をシミュレート
          check: false
        }
      ];

      const result = handler['convertItemsToSheetData'](items);

      expect(result).toEqual([
        ['name', 'category', 'until', 'check'],
        ['テスト商品', '食品', '2025-07-24', 0] // 1日前にならないことを確認
      ]);
    });

    it('should output numeric completion values (1,0) for spreadsheet writing', () => {
      const items = [
        {
          name: '完了済みアイテム',
          category: '食品' as any,
          until: null,
          check: true  // boolean true
        },
        {
          name: '未完了アイテム',
          category: '日用品' as any,
          until: null,
          check: false // boolean false
        }
      ];

      const result = handler['convertItemsToSheetData'](items);

      // スプレッドシート書き込み時は数値1,0を期待
      expect(result).toEqual([
        ['name', 'category', 'until', 'check'],
        ['完了済みアイテム', '食品', '', 1],    // 数値1
        ['未完了アイテム', '日用品', '', 0]     // 数値0
      ]);

      // データ型の検証
      expect(typeof result[1][3]).toBe('number'); // 1は数値型
      expect(typeof result[2][3]).toBe('number'); // 0は数値型
      expect(result[1][3]).toBe(1);               // 厳密等価で1
      expect(result[2][3]).toBe(0);               // 厳密等価で0
    });

    // CSV完了列（4番目の列）の解析機能のテストケース
    it('should save empty string when category matches defaultCategory', () => {
      const items = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null,
          check: false
        },
        {
          name: 'パン',
          category: '日用品' as any,
          until: null,
          check: false
        }
      ];

      const result = handler['convertItemsToSheetData'](items, 'channel789', '食品');

      expect(result).toEqual([
        ['name', 'category', 'until', 'check'],
        ['牛乳', '', '', 0], // '食品'がdefaultCategoryと一致するので空文字列
        ['パン', '日用品', '', 0] // '日用品'は異なるのでそのまま
      ]);
    });

    it('should save category when different from defaultCategory', () => {
      const items = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null,
          check: false
        },
        {
          name: 'パン',
          category: '日用品' as any,
          until: null,
          check: false
        }
      ];

      const result = handler['convertItemsToSheetData'](items, 'channel789', '生活用品');

      expect(result).toEqual([
        ['name', 'category', 'until', 'check'],
        ['牛乳', '食品', '', 0], // '食品'は異なるのでそのまま
        ['パン', '日用品', '', 0] // '日用品'も異なるのでそのまま
      ]);
    });

    it('should handle null defaultCategory gracefully', () => {
      const items = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null,
          check: false
        }
      ];

      const result = handler['convertItemsToSheetData'](items, 'channel789', null);

      expect(result).toEqual([
        ['name', 'category', 'until', 'check'],
        ['牛乳', '食品', '', 0] // defaultCategoryがnullなので通常通り
      ]);
    });

    it('should handle undefined defaultCategory gracefully', () => {
      const items = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null,
          check: false
        }
      ];

      const result = handler['convertItemsToSheetData'](items, 'channel789');

      expect(result).toEqual([
        ['name', 'category', 'until', 'check'],
        ['牛乳', '食品', '', 0] // defaultCategoryがundefinedなので通常通り
      ]);
    });

    // CSV完了列（4番目の列）の解析機能のテストケース
    describe('CSV completion column parsing', () => {
      it('should parse CSV with completion column as boolean true for "1"', () => {
        const csvText = '牛乳,食品,2024-12-31,1\nパン,食品,,0';
        const result = handler['parseCsvText'](csvText);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(expect.objectContaining({
          name: '牛乳',
          category: '食品',
          until: new Date('2024-12-31'),
          check: true
        }));
        expect(result[1]).toEqual(expect.objectContaining({
          name: 'パン',
          category: '食品',
          until: null,
          check: false
        }));
      });

      it('should parse CSV with completion column as boolean false for "0"', () => {
        const csvText = '牛乳,食品,,0\nパン,食品,,1';
        const result = handler['parseCsvText'](csvText);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(expect.objectContaining({
          name: '牛乳',
          category: '食品',
          until: null,
          check: false
        }));
        expect(result[1]).toEqual(expect.objectContaining({
          name: 'パン',
          category: '食品',
          until: null,
          check: true
        }));
      });

      it('should default completion to false when column is omitted', () => {
        const csvText = '牛乳,食品,2024-12-31\nパン,食品';
        const result = handler['parseCsvText'](csvText);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(expect.objectContaining({
          name: '牛乳',
          category: '食品',
          until: new Date('2024-12-31'),
          check: false
        }));
        expect(result[1]).toEqual(expect.objectContaining({
          name: 'パン',
          category: '食品',
          until: null,
          check: false
        }));
      });

      it('should default completion to false when column is empty', () => {
        const csvText = '牛乳,食品,2024-12-31,\nパン,食品,,  ';
        const result = handler['parseCsvText'](csvText);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(expect.objectContaining({
          name: '牛乳',
          category: '食品',
          until: new Date('2024-12-31'),
          check: false
        }));
        expect(result[1]).toEqual(expect.objectContaining({
          name: 'パン',
          category: '食品',
          until: null,
          check: false
        }));
      });

      it('should default completion to false for invalid values', () => {
        const csvText = '牛乳,食品,,2\nパン,食品,,yes\n卵,食品,,no\nバター,食品,,true';
        const result = handler['parseCsvText'](csvText);

        expect(result).toHaveLength(4);
        expect(result[0]).toEqual(expect.objectContaining({
          name: '牛乳',
          category: '食品',
          check: false // "2" は無効値なのでfalse
        }));
        expect(result[1]).toEqual(expect.objectContaining({
          name: 'パン',
          category: '食品',
          check: false // "yes" は無効値なのでfalse
        }));
        expect(result[2]).toEqual(expect.objectContaining({
          name: '卵',
          category: '食品',
          check: false // "no" は無効値なのでfalse
        }));
        expect(result[3]).toEqual(expect.objectContaining({
          name: 'バター',
          category: '食品',
          check: false // "true" は無効値なのでfalse
        }));
      });

      it('should handle mixed format CSV with some items having completion column', () => {
        const csvText = '牛乳,食品,2024-12-31,1\nパン,食品\n卵,食品,,0\nバター,食品,2024-12-25';
        const result = handler['parseCsvText'](csvText);

        expect(result).toHaveLength(4);
        expect(result[0]).toEqual(expect.objectContaining({
          name: '牛乳',
          category: '食品',
          until: new Date('2024-12-31'),
          check: true
        }));
        expect(result[1]).toEqual(expect.objectContaining({
          name: 'パン',
          category: '食品',
          until: null,
          check: false // 完了列なしなのでfalse
        }));
        expect(result[2]).toEqual(expect.objectContaining({
          name: '卵',
          category: '食品',
          until: null,
          check: false
        }));
        expect(result[3]).toEqual(expect.objectContaining({
          name: 'バター',
          category: '食品',
          until: new Date('2024-12-25'),
          check: false // 完了列なしなのでfalse
        }));
      });
    });
  });

  describe('calculateChanges', () => {
    it('should treat null category and defaultCategory as equivalent for change detection', () => {
      const existingItems = [
        {
          name: '牛乳',
          category: null,
          until: null,
          check: false
        }
      ];
      
      const editedItems = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null,
          check: false
        }
      ];

      const result = handler['calculateChanges'](existingItems, editedItems, '食品');

      // 空白→defaultCategoryは変更なしとして扱う
      expect(result.modified).toHaveLength(0);
    });

    it('should treat defaultCategory and null category as equivalent for change detection', () => {
      const existingItems = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null,
          check: false
        }
      ];
      
      const editedItems = [
        {
          name: '牛乳',
          category: null,
          until: null,
          check: false
        }
      ];

      const result = handler['calculateChanges'](existingItems, editedItems, '食品');

      // defaultCategory→空白は変更なしとして扱う
      expect(result.modified).toHaveLength(0);
    });

    it('should detect changes when category changes to non-defaultCategory', () => {
      const existingItems = [
        {
          name: '牛乳',
          category: null,
          until: null,
          check: false
        }
      ];
      
      const editedItems = [
        {
          name: '牛乳',
          category: '日用品' as any,
          until: null,
          check: false
        }
      ];

      const result = handler['calculateChanges'](existingItems, editedItems, '食品');

      // 空白→異なるカテゴリは変更として扱う
      expect(result.modified).toHaveLength(1);
      expect(result.modified[0]).toEqual({
        name: '牛乳',
        before: { category: null },
        after: { category: '日用品' }
      });
    });

    it('should detect changes when defaultCategory changes to different category', () => {
      const existingItems = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null,
          check: false
        }
      ];
      
      const editedItems = [
        {
          name: '牛乳',
          category: '日用品' as any,
          until: null,
          check: false
        }
      ];

      const result = handler['calculateChanges'](existingItems, editedItems, '食品');

      // defaultCategory→異なるカテゴリは変更として扱う
      expect(result.modified).toHaveLength(1);
      expect(result.modified[0]).toEqual({
        name: '牛乳',
        before: { category: '食品' },
        after: { category: '日用品' }
      });
    });

    it('should work without defaultCategory parameter', () => {
      const existingItems = [
        {
          name: '牛乳',
          category: '食品' as any,
          until: null,
          check: false
        }
      ];
      
      const editedItems = [
        {
          name: '牛乳',
          category: '日用品' as any,
          until: null,
          check: false
        }
      ];

      const result = handler['calculateChanges'](existingItems, editedItems);

      // defaultCategoryなしでも従来通り動作
      expect(result.modified).toHaveLength(1);
      expect(result.modified[0]).toEqual({
        name: '牛乳',
        before: { category: '食品' },
        after: { category: '日用品' }
      });
    });
  });

  describe('getItemChanges', () => {
    it('should not detect category change when null and defaultCategory are equivalent', () => {
      const before = {
        name: '牛乳',
        category: null,
        until: null,
        check: false
      };
      
      const after = {
        name: '牛乳',
        category: '食品' as any,
        until: null,
        check: false
      };

      const result = handler['getItemChanges'](before, after, '食品');

      // null→defaultCategoryは変更なし
      expect(result.before).toEqual({});
      expect(result.after).toEqual({});
    });

    it('should not detect category change when defaultCategory and null are equivalent', () => {
      const before = {
        name: '牛乳',
        category: '食品' as any,
        until: null,
        check: false
      };
      
      const after = {
        name: '牛乳',
        category: null,
        until: null,
        check: false
      };

      const result = handler['getItemChanges'](before, after, '食品');

      // defaultCategory→nullは変更なし
      expect(result.before).toEqual({});
      expect(result.after).toEqual({});
    });

    it('should detect category change when changing to non-defaultCategory', () => {
      const before = {
        name: '牛乳',
        category: null,
        until: null,
        check: false
      };
      
      const after = {
        name: '牛乳',
        category: '日用品' as any,
        until: null,
        check: false
      };

      const result = handler['getItemChanges'](before, after, '食品');

      // null→異なるカテゴリは変更として検出
      expect(result.before).toEqual({ category: null });
      expect(result.after).toEqual({ category: '日用品' });
    });

    it('should work without defaultCategory parameter (backward compatibility)', () => {
      const before = {
        name: '牛乳',
        category: null,
        until: null,
        check: false
      };
      
      const after = {
        name: '牛乳',
        category: '食品' as any,
        until: null,
        check: false
      };

      const result = handler['getItemChanges'](before, after);

      // defaultCategoryなしでは従来通りの動作
      expect(result.before).toEqual({ category: null });
      expect(result.after).toEqual({ category: '食品' });
    });
  });

  describe('getSuccessMessage', () => {
    it('should return success message', () => {
      expect(handler.getSuccessMessage()).toBe('✅ リストが正常に更新されました！');
    });
  });
});
