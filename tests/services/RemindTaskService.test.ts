import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemindTaskService } from '../../src/services/RemindTaskService';

describe('RemindTaskService', () => {
  it('uses the database initial revision when recording a newly created message', async () => {
    const repository = {
      appendTask: vi.fn().mockResolvedValue({ success: true }),
      patchTask: vi.fn(async (_channel, task) => {
        if (task.revision !== '0') throw new Error('revision conflict');
        return { success: true };
      })
    };
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true }) };
    const messages = { createTaskMessage: vi.fn().mockResolvedValue({ success: true, messageId: '456' }) };
    const service = new RemindTaskService(repository as any, metadata as any, messages as any, () => 'task');
    expect((await service.addTask('123', {title:'米',intervalDays:1}, {} as any, new Date('2026-01-01T00:00:00Z'))).success).toBe(true);
  });
  let mockRepository: any;
  let mockMetadataManager: any;
  let mockMessageManager: any;

  beforeEach(() => {
    mockRepository = {
      appendTask: vi.fn().mockResolvedValue({ success: true }),
      patchTask: vi.fn().mockResolvedValue({ success: true })
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
    expect(mockRepository.patchTask).toHaveBeenCalled();
  });

  it('defaults timeOfDay to 00:00 when omitted', async () => {
    const service = new RemindTaskService(
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

  it('returns failure when messageId persistence fails', async () => {
    mockRepository.patchTask.mockResolvedValue({ success: false, message: 'update failed' });

    const service = new RemindTaskService(
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

    expect(result.success).toBe(false);
    expect(result.message).toBe('update failed');
  });
});
