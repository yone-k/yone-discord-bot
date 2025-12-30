import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemindMetadataManager } from '../../src/services/RemindMetadataManager';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';

vi.mock('../../src/services/GoogleSheetsService');

describe('RemindMetadataManager', () => {
  let mockGoogleSheetsService: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let manager: RemindMetadataManager;

  beforeEach(() => {
    mockGoogleSheetsService = {
      getSheetDataByName: vi.fn(),
      createSheetByName: vi.fn(),
      appendSheetData: vi.fn(),
      updateSheetData: vi.fn()
    };

    vi.mocked(GoogleSheetsService.getInstance).mockReturnValue(mockGoogleSheetsService);
    manager = RemindMetadataManager.getInstance();
  });

  afterEach(() => {
    vi.clearAllMocks();
    (RemindMetadataManager as any).instance = undefined;
  });

  it('creates remind metadata sheet when missing', async () => {
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([]);
    mockGoogleSheetsService.createSheetByName.mockResolvedValue({ success: true, sheetId: 1 });
    mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });

    const result = await manager.getOrCreateMetadataSheet();

    expect(mockGoogleSheetsService.createSheetByName).toHaveBeenCalledWith('remind_metadata');
    expect(result.success).toBe(true);
  });

  it('returns channel metadata when exists', async () => {
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      [
        'channel_id',
        'message_id',
        'list_title',
        'last_sync_time',
        'operation_log_thread_id',
        'remind_notice_thread_id',
        'remind_notice_message_id'
      ],
      ['channel-1', 'message-1', 'リマインドリスト', '2025-12-29T09:00:00+09:00', 'thread-1', 'remind-thread-1', 'notice-msg-1']
    ]);

    const result = await manager.getChannelMetadata('channel-1');

    expect(result.success).toBe(true);
    expect(result.metadata?.messageId).toBe('message-1');
    expect(result.metadata?.operationLogThreadId).toBe('thread-1');
    expect(result.metadata?.remindNoticeThreadId).toBe('remind-thread-1');
    expect(result.metadata?.remindNoticeMessageId).toBe('notice-msg-1');
  });

  it('updates channel metadata', async () => {
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      [
        'channel_id',
        'message_id',
        'list_title',
        'last_sync_time',
        'operation_log_thread_id',
        'remind_notice_thread_id',
        'remind_notice_message_id'
      ],
      ['channel-1', 'message-1', 'リマインドリスト', '2025-12-29T09:00:00+09:00', 'thread-1', 'remind-thread-1', 'notice-msg-1']
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    const result = await manager.updateChannelMetadata('channel-1', {
      messageId: 'message-2',
      listTitle: 'リマインドリスト',
      operationLogThreadId: 'thread-1',
      remindNoticeThreadId: 'remind-thread-1',
      remindNoticeMessageId: 'notice-msg-1'
    });

    expect(result.success).toBe(true);
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalled();
  });

  it('lists all channel metadata', async () => {
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      [
        'channel_id',
        'message_id',
        'list_title',
        'last_sync_time',
        'operation_log_thread_id',
        'remind_notice_thread_id',
        'remind_notice_message_id'
      ],
      ['channel-1', '', 'リマインドリスト', '2025-12-29T09:00:00+09:00', '', '', ''],
      ['channel-2', '', 'リマインドリスト', '2025-12-29T09:00:00+09:00', '', '', '']
    ]);

    const result = await manager.listChannelMetadata();

    expect(result).toHaveLength(2);
    expect(result[0].channelId).toBe('channel-1');
  });
});
