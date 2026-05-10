import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemindMetadataManager } from '../../src/services/RemindMetadataManager';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';

vi.mock('../../src/services/GoogleSheetsService');

describe('RemindMetadataManager', () => {
  let mockGoogleSheetsService: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let manager: RemindMetadataManager;
  const metadataHeaders = [
    'channel_id',
    'message_id',
    'list_title',
    'last_sync_time',
    'operation_log_thread_id',
    'remind_notice_thread_id',
    'remind_notice_message_id',
    'linked_inventory_channel_id'
  ];

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
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith(
      'remind_metadata',
      { skipCache: true }
    );
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

  it('saves linked inventory channel id when creating channel metadata', async () => {
    // Given
    const sheetData: string[][] = [metadataHeaders];
    mockGoogleSheetsService.getSheetDataByName.mockImplementation(async () => sheetData);
    mockGoogleSheetsService.appendSheetData.mockImplementation(async (_sheetName: string, rows: string[][]) => {
      sheetData.push(...rows);
      return { success: true };
    });

    // When
    await (manager.createChannelMetadata as any)(
      'channel-1',
      'message-1',
      'リマインドリスト',
      'thread-1',
      'remind-thread-1',
      'notice-msg-1',
      'inventory-channel-1'
    );
    const result = await manager.getChannelMetadata('channel-1');

    // Then
    expect(result.success).toBe(true);
    expect((result.metadata as any)?.linkedInventoryChannelId).toBe('inventory-channel-1');
  });

  it('updates linked inventory channel id', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      metadataHeaders,
      [
        'channel-1',
        'message-1',
        'リマインドリスト',
        '2025-12-29T09:00:00+09:00',
        'thread-1',
        'remind-thread-1',
        'notice-msg-1',
        'inventory-channel-1'
      ]
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    // When
    const result = await manager.updateChannelMetadata('channel-1', {
      linkedInventoryChannelId: 'inventory-channel-2'
    } as any);

    // Then
    expect(result.success).toBe(true);
    expect((result.metadata as any)?.linkedInventoryChannelId).toBe('inventory-channel-2');
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith(
      'remind_metadata',
      { skipCache: true }
    );
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
      'remind_metadata',
      expect.arrayContaining([
        expect.arrayContaining(['inventory-channel-2'])
      ])
    );
  });

  it('clears linked inventory channel id when updating it to empty string', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      metadataHeaders,
      [
        'channel-1',
        'message-1',
        'リマインドリスト',
        '2025-12-29T09:00:00+09:00',
        'thread-1',
        'remind-thread-1',
        'notice-msg-1',
        'inventory-channel-1'
      ]
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    // When
    const result = await manager.updateChannelMetadata('channel-1', {
      linkedInventoryChannelId: ''
    } as any);

    // Then
    expect(result.success).toBe(true);
    expect((result.metadata as any)?.linkedInventoryChannelId).toBeUndefined();
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith(
      'remind_metadata',
      { skipCache: true }
    );
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
      'remind_metadata',
      expect.arrayContaining([
        expect.arrayContaining([''])
      ])
    );
  });

  it('returns undefined linked inventory channel id for old metadata without linked inventory column', async () => {
    // Given
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

    // When
    const result = await manager.getChannelMetadata('channel-1');

    // Then
    expect(result.success).toBe(true);
    expect((result.metadata as any)?.linkedInventoryChannelId).toBeUndefined();
  });

  it('finds channel ids linked to inventory channel', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      metadataHeaders,
      ['channel-1', 'message-1', 'リマインドリスト', '2025-12-29T09:00:00+09:00', '', '', '', 'inventory-channel-1'],
      ['channel-2', 'message-2', 'リマインドリスト', '2025-12-29T09:00:00+09:00', '', '', '', 'inventory-channel-2'],
      ['channel-3', 'message-3', 'リマインドリスト', '2025-12-29T09:00:00+09:00', '', '', '', 'inventory-channel-1']
    ]);

    // When
    const result = await (manager as any).findChannelsLinkedToInventory('inventory-channel-1');

    // Then
    expect(result).toEqual(['channel-1', 'channel-3']);
  });

  it('returns empty array when no channel is linked to inventory channel', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      metadataHeaders,
      ['channel-1', 'message-1', 'リマインドリスト', '2025-12-29T09:00:00+09:00', '', '', '', 'inventory-channel-1']
    ]);

    // When
    const result = await (manager as any).findChannelsLinkedToInventory('inventory-channel-2');

    // Then
    expect(result).toEqual([]);
  });
});
