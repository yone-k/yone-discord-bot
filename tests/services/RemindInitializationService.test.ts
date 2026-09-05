import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemindInitializationService } from '../../src/services/RemindInitializationService';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindInitializationService', () => {
  let mockRepository: any;
  let mockMetadataManager: any;
  let mockMessageManager: any;

  beforeEach(() => {
    mockRepository = {
      fetchTasks: vi.fn(),
      patchTask: vi.fn().mockResolvedValue({ success: true })
    };
    mockMetadataManager = {
      getChannelMetadata: vi.fn().mockResolvedValue({ success: false }),
      createChannelMetadata: vi.fn().mockResolvedValue({ success: true }),
      updateChannelMetadata: vi.fn().mockResolvedValue({ success: true })
    };
    mockMessageManager = {
      createTaskMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
      updateTaskMessage: vi.fn().mockResolvedValue({ success: true }),
      ensureReminderThread: vi.fn().mockResolvedValue({ success: true, threadId: 'thread-1', parentMessageId: 'notice-1' })
    };
  });

  it.each([
    { success: false, message: '通知スレッドを作成できません' },
    { success: true, threadId: 'thread-1' },
    { success: true, parentMessageId: 'notice-1' }
  ])('reports initialization failure for an unavailable or incomplete reminder thread: %j', async (threadResult) => {
    mockMessageManager.ensureReminderThread.mockResolvedValue(threadResult);
    mockRepository.fetchTasks.mockResolvedValue([]);
    const service = new RemindInitializationService(mockRepository, mockMetadataManager, mockMessageManager);
    const result = await service.initialize('channel-1', {} as any, 'リマインドリスト');
    expect(result.success).toBe(false);
    expect(result.message).toBeTruthy();
    expect(mockRepository.fetchTasks).not.toHaveBeenCalled();
  });

  it('creates messages for tasks without messageId', async () => {
    const task = createRemindTask({
      id: 'task-1',
      title: '掃除',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });
    mockRepository.fetchTasks.mockResolvedValue([task]);

    const service = new RemindInitializationService(
      mockRepository,
      mockMetadataManager,
      mockMessageManager
    );

    const result = await service.initialize('channel-1', {} as any, 'リマインドリスト');

    expect(result.success).toBe(true);
    expect(mockMessageManager.ensureReminderThread).toHaveBeenCalled();
    expect(mockMessageManager.createTaskMessage).toHaveBeenCalled();
    expect(mockRepository.patchTask).toHaveBeenCalled();
    expect(mockMessageManager.ensureReminderThread.mock.invocationCallOrder[0])
      .toBeLessThan(mockRepository.fetchTasks.mock.invocationCallOrder[0]);
  });

  it('recreates message when existing message is missing', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-old',
      title: '掃除',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });
    mockRepository.fetchTasks.mockResolvedValue([task]);
    mockMessageManager.updateTaskMessage.mockRejectedValue(new Error('Unknown Message'));
    mockMessageManager.createTaskMessage.mockResolvedValue({ success: true, messageId: 'msg-new' });

    const service = new RemindInitializationService(
      mockRepository,
      mockMetadataManager,
      mockMessageManager
    );

    const result = await service.initialize('channel-1', {} as any, 'リマインドリスト');

    expect(result.success).toBe(true);
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalled();
    expect(mockMessageManager.createTaskMessage).toHaveBeenCalled();
    expect(mockRepository.patchTask).toHaveBeenCalledWith(
      'channel-1',
      expect.anything(),
      expect.objectContaining({ messageId: 'msg-new' })
    );
  });

  it('fails when recreated messageId cannot be persisted', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-old',
      title: '掃除',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });
    mockRepository.fetchTasks.mockResolvedValue([task]);
    mockRepository.patchTask.mockResolvedValue({ success: false, message: 'update failed' });
    mockMessageManager.updateTaskMessage.mockRejectedValue(new Error('Unknown Message'));
    mockMessageManager.createTaskMessage.mockResolvedValue({ success: true, messageId: 'msg-new' });

    const service = new RemindInitializationService(
      mockRepository,
      mockMetadataManager,
      mockMessageManager
    );

    const result = await service.initialize('channel-1', {} as any, 'リマインドリスト');

    expect(result.success).toBe(false);
    expect(result.message).toBe('update failed');
  });
});
