import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalSubmitInteraction, Client } from 'discord.js';
import { Logger } from '../../src/utils/logger';
import { AddListModalHandler } from '../../src/modals/AddListModalHandler';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import { MessageManager } from '../../src/services/MessageManager';
import { MetadataManager } from '../../src/services/MetadataManager';
import { ModalHandlerContext } from '../../src/base/BaseModalHandler';

describe('AddListModalHandler', () => {
  let handler: AddListModalHandler;
  let logger: Logger;
  let mockGoogleSheetsService: GoogleSheetsService;
  let mockMessageManager: MessageManager;
  let mockMetadataManager: MetadataManager;
  let mockInteraction: ModalSubmitInteraction;
  let context: ModalHandlerContext;
  let mockFields: any;
  let mockClient: Client;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as any;

    mockGoogleSheetsService = {
      getSheetData: vi.fn(),
      updateSheetData: vi.fn()
    } as any;

    mockMessageManager = {
      createOrUpdateMessageWithMetadata: vi.fn()
    } as any;

    mockMetadataManager = {
      getChannelMetadata: vi.fn()
    } as any;

    mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          name: 'test-channel'
        })
      }
    } as any;

    mockFields = {
      getTextInputValue: vi.fn()
    };

    mockInteraction = {
      customId: 'add-list-modal',
      user: {
        id: 'user123',
        bot: false
      },
      channelId: 'channel789',
      fields: mockFields,
      client: mockClient
    } as any;

    context = {
      interaction: mockInteraction
    };

    handler = new AddListModalHandler(logger, mockGoogleSheetsService, mockMessageManager, mockMetadataManager);
  });

  describe('executeAction', () => {
    it('should add new items to existing list with category', async () => {
      const category = '食品';
      const items = '牛乳,2024-12-31\nパン';
      
      mockFields.getTextInputValue
        .mockReturnValueOnce(category)
        .mockReturnValueOnce(items);
      
      // 既存データをモック
      const existingData = [
        ['name', 'category', 'until'],
        ['既存アイテム', 'その他', '']
      ];
      mockGoogleSheetsService.getSheetData.mockResolvedValue(existingData);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({ success: true });

      await handler['executeAction'](context);

      expect(mockFields.getTextInputValue).toHaveBeenCalledWith('category');
      expect(mockFields.getTextInputValue).toHaveBeenCalledWith('items');
      expect(mockGoogleSheetsService.getSheetData).toHaveBeenCalledWith('channel789');
      expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
        'channel789',
        expect.arrayContaining([
          ['name', 'category', 'until'],
          ['既存アイテム', 'その他', ''],
          ['牛乳', '食品', '2024-12-31'],
          ['パン', '食品', '']
        ])
      );
      expect(logger.info).toHaveBeenCalledWith(
        'List items added successfully',
        expect.objectContaining({
          channelId: 'channel789',
          newItemsCount: 2,
          totalItemsCount: 3,
          userId: 'user123'
        })
      );
    });

    it('should add new items without category (null category)', async () => {
      const category = '';
      const items = '牛乳,2024-12-31\nパン';
      
      mockFields.getTextInputValue
        .mockReturnValueOnce(category)
        .mockReturnValueOnce(items);
      
      const existingData = [['name', 'category', 'until']];
      mockGoogleSheetsService.getSheetData.mockResolvedValue(existingData);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({ success: true });

      await handler['executeAction'](context);

      expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
        'channel789',
        expect.arrayContaining([
          ['name', 'category', 'until'],
          ['牛乳', '', '2024-12-31'],
          ['パン', '', '']
        ])
      );
    });

    it('should handle empty existing list', async () => {
      const category = '食品';
      const items = '牛乳';
      
      mockFields.getTextInputValue
        .mockReturnValueOnce(category)
        .mockReturnValueOnce(items);
      
      const existingData: string[][] = [];
      mockGoogleSheetsService.getSheetData.mockResolvedValue(existingData);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({ success: true });

      await handler['executeAction'](context);

      expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
        'channel789',
        [
          ['name', 'category', 'until'],
          ['牛乳', '食品', '']
        ]
      );
    });

    it('should throw error when channelId is missing', async () => {
      mockInteraction.channelId = null;

      await expect(handler['executeAction'](context)).rejects.toThrow('チャンネルIDが取得できません');
    });

    it('should throw error when items field is empty', async () => {
      mockFields.getTextInputValue
        .mockReturnValueOnce('食品')
        .mockReturnValueOnce('');

      await expect(handler['executeAction'](context)).rejects.toThrow('追加するアイテムが入力されていません');
    });

    it('should skip duplicate names', async () => {
      const category = '食品';
      const items = '牛乳\n既存アイテム\nパン';
      
      mockFields.getTextInputValue
        .mockReturnValueOnce(category)
        .mockReturnValueOnce(items);
      
      const existingData = [
        ['name', 'category', 'until'],
        ['既存アイテム', 'その他', '']
      ];
      mockGoogleSheetsService.getSheetData.mockResolvedValue(existingData);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({ success: true });

      await handler['executeAction'](context);

      // 重複する「既存アイテム」はスキップされ、「牛乳」と「パン」のみ追加される
      expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
        'channel789',
        [
          ['name', 'category', 'until'],
          ['既存アイテム', 'その他', ''],
          ['牛乳', '食品', ''],
          ['パン', '食品', '']
        ]
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Duplicate name found, skipping',
        expect.objectContaining({
          name: '既存アイテム'
        })
      );
    });

    it('should handle too many items error', async () => {
      const category = '食品';
      const longItemsList = Array.from({ length: 150 }, (_, i) => `アイテム${i}`).join('\n');
      
      mockFields.getTextInputValue
        .mockReturnValueOnce(category)
        .mockReturnValueOnce(longItemsList);
      
      const existingData = [['name', 'category', 'until']];
      mockGoogleSheetsService.getSheetData.mockResolvedValue(existingData);

      await expect(handler['executeAction'](context)).rejects.toThrow('アイテム数が多すぎます');
    });

    it('should parse date correctly', async () => {
      const category = '食品';
      const items = '牛乳,2024-12-31\nパン,invalid-date\nシャンプー,2024-06-15';
      
      mockFields.getTextInputValue
        .mockReturnValueOnce(category)
        .mockReturnValueOnce(items);
      
      const existingData = [['name', 'category', 'until']];
      mockGoogleSheetsService.getSheetData.mockResolvedValue(existingData);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });
      mockMessageManager.createOrUpdateMessageWithMetadata.mockResolvedValue({ success: true });

      await handler['executeAction'](context);

      expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
        'channel789',
        [
          ['name', 'category', 'until'],
          ['牛乳', '食品', '2024-12-31'],
          ['パン', '食品', ''],
          ['シャンプー', '食品', '2024-06-15']
        ]
      );
    });

    it('should handle GoogleSheets service error', async () => {
      const category = '食品';
      const items = '牛乳';
      
      mockFields.getTextInputValue
        .mockReturnValueOnce(category)
        .mockReturnValueOnce(items);
      
      const existingData = [['name', 'category', 'until']];
      mockGoogleSheetsService.getSheetData.mockResolvedValue(existingData);
      mockGoogleSheetsService.updateSheetData.mockResolvedValue({ 
        success: false, 
        message: 'Sheet update failed' 
      });

      await expect(handler['executeAction'](context)).rejects.toThrow('スプレッドシートの更新に失敗しました: Sheet update failed');
    });
  });

  describe('getSuccessMessage', () => {
    it('should return correct success message', () => {
      expect(handler['getSuccessMessage']()).toBe('✅ リストに項目が追加されました！');
    });
  });

  describe('shouldHandle', () => {
    it('should handle add-list-modal customId', () => {
      expect(handler.shouldHandle(context)).toBe(true);
    });

    it('should not handle other customIds', () => {
      mockInteraction.customId = 'other-modal';
      expect(handler.shouldHandle(context)).toBe(false);
    });
  });

  describe('getCustomId', () => {
    it('should return correct customId', () => {
      expect(handler.getCustomId()).toBe('add-list-modal');
    });
  });
});