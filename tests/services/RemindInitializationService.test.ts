import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemindInitializationService } from '../../src/services/RemindInitializationService';
import { createRemindTask } from '../helpers/RemindTask';
import { CoreApiError } from '../../src/api/CoreClient';

describe('RemindInitializationService', () => {
  let mockRepository: any;
  let mockMetadataManager: any;
  let mockMessageManager: any;

  beforeEach(() => {
    mockRepository = {
      fetchTasks: vi.fn(),
      patchTask: vi.fn().mockImplementation(async (_channel, task, patch) => ({ success: true, task: { ...task, ...patch } }))
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
    expect(mockMessageManager.updateTaskMessage).not.toHaveBeenCalled();
    expect(mockMessageManager.ensureReminderThread.mock.invocationCallOrder[0])
      .toBeLessThan(mockRepository.fetchTasks.mock.invocationCallOrder[0]);
  });
  it('does not create a duplicate message after a transient update failure', async () => {
    const task = { id: 'task', messageId: 'existing', revision: '4' };
    mockRepository.fetchTasks.mockResolvedValue([task]);
    mockMessageManager.updateTaskMessage.mockRejectedValue(new Error('connection lost'));
    const service = new RemindInitializationService(mockRepository, mockMetadataManager, mockMessageManager);
    await expect(service.initialize('channel-1', {} as any, 'リマインドリスト')).rejects.toThrow('connection lost');
    expect(mockMessageManager.createTaskMessage).not.toHaveBeenCalled();
    expect(mockRepository.patchTask).not.toHaveBeenCalled();
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
    mockMessageManager.updateTaskMessage.mockRejectedValueOnce(Object.assign(new Error('Unknown Message'), { code: 10008 }));
    mockRepository.patchTask.mockResolvedValue({ success: true, task: { ...task, revision: '1', messageId: 'msg-new' } });
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
    mockRepository.patchTask.mockRejectedValue(new CoreApiError('conflict', 409));
    mockMessageManager.updateTaskMessage.mockRejectedValueOnce(Object.assign(new Error('Unknown Message'), { code: 10008 }));
    mockMessageManager.createTaskMessage.mockResolvedValue({ success: true, messageId: 'msg-new' });

    const service = new RemindInitializationService(
      mockRepository,
      mockMetadataManager,
      mockMessageManager
    );

    await expect(service.initialize('channel-1', {} as any, 'リマインドリスト')).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(mockRepository.patchTask).toHaveBeenCalledTimes(1);
  });
});
