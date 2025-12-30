import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemindTaskService } from '../../src/services/RemindTaskService';

describe('RemindTaskService', () => {
  let mockSheetManager: any;
  let mockRepository: any;
  let mockMetadataManager: any;
  let mockMessageManager: any;

  beforeEach(() => {
    mockSheetManager = {
      getOrCreateChannelSheet: vi.fn().mockResolvedValue({ existed: true })
    };
    mockRepository = {
      appendTask: vi.fn().mockResolvedValue({ success: true }),
      updateTask: vi.fn().mockResolvedValue({ success: true })
    };
    mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({ success: false }),
      createChannelMetadata: vi.fn().mockResolvedValue({ success: true })
    };
    mockMessageManager = {
      createTaskMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' })
    };
  });

  it('adds task and updates message id', async () => {
    const service = new RemindTaskService(
      mockSheetManager,
      mockRepository,
      mockMetadataManager,
      mockMessageManager,
      () => 'task-1'
    );

    const result = await service.addTask(
      'channel-1',
      {
        title: '掃除',
        intervalDays: 7,
        timeOfDay: '09:00',
        remindBeforeMinutes: 1440
      },
      {} as any,
      new Date('2025-12-29T09:00:00+09:00'),
      'リマインドリスト'
    );

    expect(result.success).toBe(true);
    expect(mockRepository.appendTask).toHaveBeenCalled();
    expect(mockMessageManager.createTaskMessage).toHaveBeenCalled();
    expect(mockRepository.updateTask).toHaveBeenCalled();
  });

  it('defaults timeOfDay to 00:00 when omitted', async () => {
    const service = new RemindTaskService(
      mockSheetManager,
      mockRepository,
      mockMetadataManager,
      mockMessageManager,
      () => 'task-1'
    );

    await service.addTask(
      'channel-1',
      {
        title: '掃除',
        intervalDays: 7,
        remindBeforeMinutes: 1440
      },
      {} as any,
      new Date('2025-12-29T09:00:00+09:00'),
      'リマインドリスト'
    );

    expect(mockRepository.appendTask).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({ timeOfDay: '00:00' })
    );
  });
});
