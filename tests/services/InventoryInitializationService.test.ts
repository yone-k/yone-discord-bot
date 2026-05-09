import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventoryInitializationService } from '../../src/services/InventoryInitializationService';
import { getInventorySheetHeaders } from '../../src/utils/InventorySheetMapper';

describe('InventoryInitializationService', () => {
  type MockGoogleSheetsService = {
    createSheetByName: ReturnType<typeof vi.fn>;
    appendSheetData: ReturnType<typeof vi.fn>;
  };

  type MockInventoryMetadataManager = {
    getOrCreateMetadataSheet: ReturnType<typeof vi.fn>;
  };

  type MockInventoryMessageManager = {
    createOrUpdateMessage: ReturnType<typeof vi.fn>;
  };

  let googleSheetsService: MockGoogleSheetsService;
  let metadataManager: MockInventoryMetadataManager;
  let messageManager: MockInventoryMessageManager;
  let service: InventoryInitializationService;

  const client = { channels: { fetch: vi.fn() } };
  const context = {
    channelId: 'channel-1',
    listTitle: '在庫リスト',
    client: client as any
  };

  beforeEach(() => {
    googleSheetsService = {
      createSheetByName: vi.fn().mockResolvedValue({ success: true, sheetId: 123 }),
      appendSheetData: vi.fn().mockResolvedValue({ success: true })
    };
    metadataManager = {
      getOrCreateMetadataSheet: vi.fn().mockResolvedValue({ success: true })
    };
    messageManager = {
      createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true, message: { id: 'message-1' } })
    };

    service = new InventoryInitializationService(
      googleSheetsService as any,
      metadataManager as any,
      messageManager as any
    );
  });

  it('新規初期化ではシートとメタデータシートを準備して空状態の固定メッセージを作成する', async () => {
    // Given
    const sheetName = 'inventory_channel-1';

    // When
    const result = await service.initializeInventory(context);

    // Then
    expect(result).toEqual({ success: true });
    expect(googleSheetsService.createSheetByName).toHaveBeenCalledWith(sheetName);
    expect(googleSheetsService.appendSheetData).toHaveBeenCalledWith(sheetName, [getInventorySheetHeaders()]);
    expect(metadataManager.getOrCreateMetadataSheet).toHaveBeenCalled();
    expect(messageManager.createOrUpdateMessage).toHaveBeenCalledWith(
      'channel-1',
      [],
      '在庫リスト',
      client
    );
  });

  it('シート作成に失敗した場合はsuccess:falseとエラーメッセージを返す', async () => {
    // Given
    googleSheetsService.createSheetByName.mockResolvedValue({
      success: false,
      message: 'create failed'
    });

    // When
    const result = await service.initializeInventory(context);

    // Then
    expect(result).toEqual({ success: false, message: 'create failed' });
    expect(googleSheetsService.appendSheetData).not.toHaveBeenCalled();
    expect(metadataManager.getOrCreateMetadataSheet).not.toHaveBeenCalled();
    expect(messageManager.createOrUpdateMessage).not.toHaveBeenCalled();
  });

  it('既存シートの重複エラーはok扱いにして初期化を続行する', async () => {
    // Given
    googleSheetsService.createSheetByName.mockResolvedValue({
      success: false,
      message: 'Sheet inventory_channel-1 already exists'
    });

    // When
    const result = await service.initializeInventory(context);

    // Then
    expect(result).toEqual({ success: true });
    expect(googleSheetsService.appendSheetData).not.toHaveBeenCalled();
    expect(metadataManager.getOrCreateMetadataSheet).toHaveBeenCalled();
    expect(messageManager.createOrUpdateMessage).toHaveBeenCalledWith(
      'channel-1',
      [],
      '在庫リスト',
      client
    );
  });

  it('メッセージ作成に失敗した場合はsuccess:falseを返す', async () => {
    // Given
    messageManager.createOrUpdateMessage.mockResolvedValue({
      success: false,
      errorMessage: 'message failed'
    });

    // When
    const result = await service.initializeInventory(context);

    // Then
    expect(result).toEqual({ success: false, message: 'message failed' });
    expect(metadataManager.getOrCreateMetadataSheet).toHaveBeenCalled();
  });

  it('新規シート作成後に在庫シートのヘッダーをappendSheetDataで追加する', async () => {
    // Given
    const sheetName = 'inventory_channel-1';

    // When
    await service.initializeInventory(context);

    // Then
    expect(googleSheetsService.appendSheetData).toHaveBeenCalledWith(
      sheetName,
      [getInventorySheetHeaders()]
    );
    expect(googleSheetsService.createSheetByName.mock.invocationCallOrder[0])
      .toBeLessThan(googleSheetsService.appendSheetData.mock.invocationCallOrder[0]);
  });
});
