import { describe, it, expect, vi } from 'vitest';
import { RemindTaskInventoryModalHandler } from '../../src/modals/RemindTaskInventoryModalHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskInventoryModalHandler', () => {
  it('updates inventory items and task message', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '補充チェック',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const mockRepository = {
      findTaskByMessageId: vi.fn().mockResolvedValue(task),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMessageManager = {
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true })
    };
    const mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({
        success: true,
        metadata: { linkedInventoryChannelId: 'inventory-channel-1' }
      })
    };
    const mockInventoryService = {
      resolveByName: vi.fn().mockResolvedValue({
        id: 'inventory-1',
        name: 'フィルター',
        stock: 0,
        category: ''
      })
    };

    const handler = new RemindTaskInventoryModalHandler(
      new Logger(),
      undefined,
      mockMetadataManager as any,
      mockRepository as any,
      mockMessageManager as any,
      mockInventoryService as any
    );

    const interaction = {
      customId: 'remind-task-inventory-modal:msg-1',
      user: { id: 'user-1' },
      channelId: 'channel-1',
      client: {} as any,
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('フィルター,1')
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      deleteReply: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(mockMetadataManager.getChannelMetadata).toHaveBeenCalledWith('channel-1');
    expect(mockInventoryService.resolveByName).toHaveBeenCalledWith('inventory-channel-1', 'フィルター');
    expect(mockRepository.updateTask).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'inventory-1', consume: 1 }]
      })
    );
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalled();
  });
});
