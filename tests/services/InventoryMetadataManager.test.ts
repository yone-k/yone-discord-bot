import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InventoryMetadataManager } from '../../src/services/InventoryMetadataManager';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import type { InventoryChannelMetadata } from '../../src/models/InventoryChannelMetadata';

vi.mock('../../src/services/GoogleSheetsService');

describe('InventoryMetadataManager', () => {
  type MockGoogleSheetsService = {
    getSheetDataByName: ReturnType<typeof vi.fn>;
    createSheetByName: ReturnType<typeof vi.fn>;
    appendSheetData: ReturnType<typeof vi.fn>;
    updateSheetData: ReturnType<typeof vi.fn>;
  };

  let mockGoogleSheetsService: MockGoogleSheetsService;
  let manager: InventoryMetadataManager;

  const metadataHeaders = [
    'channel_id',
    'message_id',
    'list_title',
    'last_sync_time',
    'default_category',
    'operation_log_thread_id'
  ];

  beforeEach(() => {
    mockGoogleSheetsService = {
      getSheetDataByName: vi.fn(),
      createSheetByName: vi.fn(),
      appendSheetData: vi.fn(),
      updateSheetData: vi.fn()
    };

    vi.mocked(GoogleSheetsService.getInstance).mockReturnValue(
      mockGoogleSheetsService as unknown as GoogleSheetsService
    );
    manager = InventoryMetadataManager.getInstance();
  });

  afterEach(() => {
    vi.clearAllMocks();
    (InventoryMetadataManager as unknown as { instance?: InventoryMetadataManager }).instance = undefined;
  });

  it('returns the same singleton instance', () => {
    // Given
    const first = InventoryMetadataManager.getInstance();

    // When
    const second = InventoryMetadataManager.getInstance();

    // Then
    expect(second).toBe(first);
  });

  it('creates inventory metadata sheet and appends headers when missing', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([]);
    mockGoogleSheetsService.createSheetByName.mockResolvedValue({ success: true, sheetId: 12 });
    mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });

    // When
    const result = await manager.getOrCreateMetadataSheet();

    // Then
    expect(result.success).toBe(true);
    expect(result.sheetId).toBe(12);
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith('inventory_metadata');
    expect(mockGoogleSheetsService.createSheetByName).toHaveBeenCalledWith('inventory_metadata');
    expect(mockGoogleSheetsService.appendSheetData).toHaveBeenCalledWith('inventory_metadata', [metadataHeaders]);
  });

  it('returns inventory channel metadata when channel row exists', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      metadataHeaders,
      [
        'channel-1',
        'message-1',
        '在庫リスト',
        '2026-05-09 10:00:00',
        '食品',
        'thread-1'
      ]
    ]);

    // When
    const result = await manager.getChannelMetadata('channel-1');

    // Then
    expect(result).toMatchObject<InventoryChannelMetadata>({
      channelId: 'channel-1',
      messageId: 'message-1',
      listTitle: '在庫リスト',
      defaultCategory: '食品',
      operationLogThreadId: 'thread-1'
    });
    expect(result?.lastSyncTime).toBeInstanceOf(Date);
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith('inventory_metadata');
  });

  it('returns null when channel row does not exist', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      metadataHeaders,
      ['channel-1', 'message-1', '在庫リスト', '2026-05-09 10:00:00', '食品', 'thread-1']
    ]);

    // When
    const result = await manager.getChannelMetadata('channel-2');

    // Then
    expect(result).toBeNull();
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith('inventory_metadata');
  });

  it('appends channel metadata to inventory_metadata sheet', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([metadataHeaders]);
    mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });

    // When
    const result = await manager.createChannelMetadata('channel-1', {
      messageId: 'message-1',
      listTitle: '在庫リスト',
      defaultCategory: '食品',
      operationLogThreadId: 'thread-1'
    });

    // Then
    expect(result.success).toBe(true);
    expect(mockGoogleSheetsService.appendSheetData).toHaveBeenCalledWith('inventory_metadata', [
      ['channel-1', 'message-1', '在庫リスト', expect.any(String), '食品', 'thread-1']
    ]);
  });

  it('updates matching channel metadata with updateSheetData', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      metadataHeaders,
      ['channel-1', 'message-1', '在庫リスト', '2026-05-09 10:00:00', '食品', 'thread-1'],
      ['channel-2', 'message-2', '在庫リスト2', '2026-05-09 11:00:00', '日用品', 'thread-2']
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    // When
    const result = await manager.updateChannelMetadata('channel-1', {
      messageId: 'message-3',
      listTitle: '更新後在庫リスト',
      defaultCategory: '飲料',
      operationLogThreadId: 'thread-3'
    });

    // Then
    expect(result.success).toBe(true);
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith(
      'inventory_metadata',
      { skipCache: true }
    );
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith('inventory_metadata', [
      metadataHeaders,
      ['channel-1', 'message-3', '更新後在庫リスト', expect.any(String), '飲料', 'thread-3'],
      ['channel-2', 'message-2', '在庫リスト2', '2026-05-09 11:00:00', '日用品', 'thread-2']
    ]);
  });

  it('passes inventory_metadata sheet name without converting it as a channel id', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([metadataHeaders]);
    mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });

    // When
    await manager.createChannelMetadata('inventory-channel-1', {
      messageId: 'message-1',
      listTitle: '在庫リスト',
      defaultCategory: '食品'
    });

    // Then
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith('inventory_metadata');
    expect(mockGoogleSheetsService.appendSheetData.mock.calls[0][0]).toBe('inventory_metadata');
  });

  it('keeps optional operationLogThreadId undefined when reading and writing metadata', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName
      .mockResolvedValueOnce([metadataHeaders])
      .mockResolvedValueOnce([
        metadataHeaders,
        ['channel-1', 'message-1', '在庫リスト', '2026-05-09 10:00:00', '食品', '']
      ]);
    mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });

    // When
    const createResult = await manager.createChannelMetadata('channel-1', {
      messageId: 'message-1',
      listTitle: '在庫リスト',
      defaultCategory: '食品',
      operationLogThreadId: undefined
    });
    const metadata = await manager.getChannelMetadata('channel-1');

    // Then
    expect(createResult.success).toBe(true);
    expect(mockGoogleSheetsService.appendSheetData).toHaveBeenCalledWith('inventory_metadata', [
      ['channel-1', 'message-1', '在庫リスト', expect.any(String), '食品', '']
    ]);
    expect(metadata?.operationLogThreadId).toBeUndefined();
  });
});
