import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventoryDeleteModalHandler } from '../../src/modals/InventoryDeleteModalHandler';
import { Logger } from '../../src/utils/logger';

class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('InventoryDeleteModalHandler', () => {
  let handler: InventoryDeleteModalHandler;
  let mockLogger: MockLogger;
  let mockInventoryService: {
    delete: ReturnType<typeof vi.fn>;
  };
  let mockMetadataManager: {
    getChannelMetadata: ReturnType<typeof vi.fn>;
  };
  let interaction: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = new MockLogger();
    mockInventoryService = {
      delete: vi.fn().mockResolvedValue(undefined)
    };
    mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { listTitle: '在庫リスト' }
      })
    };
    interaction = {
      customId: 'inventory_delete_modal_inventory-item-1',
      user: { id: 'user-1' },
      guildId: 'guild-1',
      channelId: 'inventory-channel-1',
      client: { channels: { fetch: vi.fn() } },
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('YES')
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn().mockResolvedValue(undefined)
    };

    handler = new InventoryDeleteModalHandler(
      mockLogger as unknown as Logger,
      undefined,
      mockMetadataManager as any,
      mockInventoryService as any,
    );
  });

  it('確認OKの場合、InventoryService.deleteを呼びTSから描画せず成功応答する', async () => {
    // Given
    interaction.fields.getTextInputValue.mockReturnValue('YES');

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(mockInventoryService.delete).toHaveBeenCalledWith('inventory-channel-1', 'inventory-item-1');
    expect(interaction.client.channels.fetch).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '処理が完了しました。' });
    expect(interaction.deleteReply).toHaveBeenCalled();
  });

  it('参照タスクがある場合、参照タスク一覧を含むエラー応答を返す', async () => {
    // Given
    mockInventoryService.delete.mockRejectedValue(
      new Error('在庫アイテムを削除できません: 参照中のタスクがあります\n- task-channel-1: 掃除\n- task-channel-2: 買い物')
    );

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(mockInventoryService.delete).toHaveBeenCalledWith('inventory-channel-1', 'inventory-item-1');
    expect(interaction.client.channels.fetch).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('参照中のタスクがあります')
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('task-channel-1: 掃除')
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('task-channel-2: 買い物')
    });
  });

  it('確認文字列が不一致の場合、キャンセル応答しdeleteを呼ばない', async () => {
    // Given
    interaction.fields.getTextInputValue.mockReturnValue('NO');

    // When
    await handler.handle({ interaction } as any);

    // Then
    expect(mockInventoryService.delete).not.toHaveBeenCalled();
    expect(interaction.client.channels.fetch).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('キャンセル')
    });
  });
});
