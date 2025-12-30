import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import { createRemindTask } from '../../src/models/RemindTask';
import { getRemindSheetHeaders } from '../../src/utils/RemindSheetMapper';

vi.mock('../../src/services/GoogleSheetsService');

describe('RemindTaskRepository', () => {
  let mockGoogleSheetsService: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let repository: RemindTaskRepository;

  beforeEach(() => {
    mockGoogleSheetsService = {
      getSheetDataByName: vi.fn(),
      updateSheetData: vi.fn(),
      appendSheetData: vi.fn(),
      validateData: vi.fn(),
      normalizeData: vi.fn()
    };

    vi.mocked(GoogleSheetsService.getInstance).mockReturnValue(mockGoogleSheetsService);
    repository = new RemindTaskRepository();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches tasks from sheet', async () => {
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getRemindSheetHeaders(),
      [
        'task-1',
        'msg-1',
        '掃除',
        '',
        '7',
        '09:00',
        '1440',
        '2025-12-29T09:00:00+09:00',
        '2026-01-05T09:00:00+09:00',
        '',
        '',
        '0',
        '',
        '0',
        '2025-12-29T09:00:00+09:00',
        '2025-12-29T09:00:00+09:00'
      ]
    ]);

    const tasks = await repository.fetchTasks('123');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('task-1');
  });

  it('updates task row by id', async () => {
    const task = createRemindTask({
      id: 'task-1',
      messageId: 'msg-1',
      title: '掃除',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 1440,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getRemindSheetHeaders(),
      [
        'task-1',
        'msg-1',
        '掃除',
        '',
        '7',
        '09:00',
        '1440',
        '2025-12-29T09:00:00+09:00',
        '2026-01-05T09:00:00+09:00',
        '',
        '',
        '0',
        '',
        '0',
        '2025-12-29T09:00:00+09:00',
        '2025-12-29T09:00:00+09:00'
      ]
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    const result = await repository.updateTask('123', task);

    expect(result.success).toBe(true);
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalled();
  });

  it('finds task by message id', async () => {
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getRemindSheetHeaders(),
      [
        'task-1',
        'msg-1',
        '掃除',
        '',
        '7',
        '09:00',
        '1440',
        '2025-12-29T09:00:00+09:00',
        '2026-01-05T09:00:00+09:00',
        '',
        '',
        '0',
        '',
        '0',
        '2025-12-29T09:00:00+09:00',
        '2025-12-29T09:00:00+09:00'
      ]
    ]);

    const task = await repository.findTaskByMessageId('123', 'msg-1');

    expect(task).not.toBeNull();
    expect(task?.id).toBe('task-1');
  });

  it('deletes task by id', async () => {
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getRemindSheetHeaders(),
      ['task-1', 'msg-1']
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    const result = await repository.deleteTask('123', 'task-1');

    expect(result.success).toBe(true);
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalled();
  });
});
