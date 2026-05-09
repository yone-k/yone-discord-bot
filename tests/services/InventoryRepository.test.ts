import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InventoryRepository } from '../../src/services/InventoryRepository';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import type { InventoryItem } from '../../src/models/InventoryItem';
import { getInventorySheetHeaders, toSheetRow } from '../../src/utils/InventorySheetMapper';

vi.mock('../../src/services/GoogleSheetsService');

describe('InventoryRepository', () => {
  let mockGoogleSheetsService: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let repository: InventoryRepository;

  const coffeeBeans: InventoryItem = {
    id: 'item-1',
    name: 'Coffee beans',
    stock: 2,
    category: 'food'
  };

  const detergent: InventoryItem = {
    id: 'item-2',
    name: 'Detergent',
    stock: 1.5,
    category: 'daily'
  };

  beforeEach(() => {
    mockGoogleSheetsService = {
      getSheetDataByName: vi.fn(),
      updateSheetData: vi.fn(),
      appendSheetData: vi.fn(),
      runWithLock: vi.fn().mockImplementation(async (_key: string, fn: () => Promise<unknown>) => fn())
    };

    vi.mocked(GoogleSheetsService.getInstance).mockReturnValue(mockGoogleSheetsService);
    repository = new InventoryRepository();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns sheet name for channel', () => {
    // Given
    const channelId = 'channel-1';

    // When
    const sheetName = repository.getSheetNameForChannel(channelId);

    // Then
    expect(sheetName).toBe('inventory_channel-1');
  });

  it('fetches all inventory items from sheet without header row', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food'],
      ['item-2', 'Detergent', '1.5', 'daily']
    ]);

    // When
    const items = await repository.fetchAll('xxx');

    // Then
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith('inventory_xxx');
    expect(items).toEqual([coffeeBeans, detergent]);
  });

  it('returns empty array when sheet has no data rows', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders()
    ]);

    // When
    const items = await repository.fetchAll('xxx');

    // Then
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith('inventory_xxx');
    expect(items).toEqual([]);
  });

  it('finds inventory item by id', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food'],
      ['item-2', 'Detergent', '1.5', 'daily']
    ]);

    // When
    const item = await repository.findById('xxx', 'item-2');

    // Then
    expect(item).toEqual(detergent);
  });

  it('returns null when inventory item id is not found', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food']
    ]);

    // When
    const item = await repository.findById('xxx', 'missing-id');

    // Then
    expect(item).toBeNull();
  });

  it('finds inventory item by name', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food'],
      ['item-2', 'Detergent', '1.5', 'daily']
    ]);

    // When
    const item = await repository.findByName('xxx', 'Coffee beans');

    // Then
    expect(item).toEqual(coffeeBeans);
  });

  it('returns null when inventory item name is not found', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food']
    ]);

    // When
    const item = await repository.findByName('xxx', 'Missing item');

    // Then
    expect(item).toBeNull();
  });

  it('appends inventory item to inventory sheet without list prefix conversion', async () => {
    // Given
    mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });

    // When
    const result = await repository.append('xxx', coffeeBeans);

    // Then
    expect(result).toEqual({ success: true });
    expect(mockGoogleSheetsService.appendSheetData).toHaveBeenCalledWith(
      'inventory_xxx',
      [toSheetRow(coffeeBeans)]
    );
    expect(mockGoogleSheetsService.appendSheetData).not.toHaveBeenCalledWith(
      'list_inventory_xxx',
      expect.anything()
    );
  });

  it('appends inventory item under the inventory channel lock', async () => {
    // Given
    mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });

    // When
    await repository.append('channel-1', coffeeBeans);

    // Then
    expect(mockGoogleSheetsService.runWithLock).toHaveBeenCalledWith(
      'inventory_channel-1',
      expect.any(Function)
    );
    expect(mockGoogleSheetsService.appendSheetData).toHaveBeenCalledWith(
      'inventory_channel-1',
      [toSheetRow(coffeeBeans)]
    );
  });

  it('updates inventory item by id and rewrites all rows', async () => {
    // Given
    const updatedCoffeeBeans: InventoryItem = {
      ...coffeeBeans,
      stock: 3,
      category: 'grocery'
    };
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food'],
      ['item-2', 'Detergent', '1.5', 'daily']
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    // When
    const result = await repository.update('xxx', updatedCoffeeBeans);

    // Then
    expect(result).toEqual({ success: true });
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
      'inventory_xxx',
      [
        getInventorySheetHeaders(),
        toSheetRow(updatedCoffeeBeans),
        ['item-2', 'Detergent', '1.5', 'daily']
      ]
    );
  });

  it('updates inventory item under the inventory channel lock', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food']
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    // When
    await repository.update('channel-1', coffeeBeans);

    // Then
    expect(mockGoogleSheetsService.runWithLock).toHaveBeenCalledWith(
      'inventory_channel-1',
      expect.any(Function)
    );
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith('inventory_channel-1');
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
      'inventory_channel-1',
      [
        getInventorySheetHeaders(),
        toSheetRow(coffeeBeans)
      ]
    );
  });

  it('updates inventory item without acquiring a lock when useLock is false', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food']
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    // When
    await repository.update('channel-1', coffeeBeans, { useLock: false });

    // Then
    expect(mockGoogleSheetsService.runWithLock).not.toHaveBeenCalled();
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
      'inventory_channel-1',
      [
        getInventorySheetHeaders(),
        toSheetRow(coffeeBeans)
      ]
    );
  });

  it('returns error when updating inventory item id is not found', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food']
    ]);

    // When
    const result = await repository.update('xxx', detergent);

    // Then
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
    expect(mockGoogleSheetsService.updateSheetData).not.toHaveBeenCalled();
  });

  it('deletes inventory item by id and rewrites remaining rows', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food'],
      ['item-2', 'Detergent', '1.5', 'daily']
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    // When
    const result = await repository.delete('xxx', 'item-1');

    // Then
    expect(result).toEqual({ success: true });
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
      'inventory_xxx',
      [
        getInventorySheetHeaders(),
        ['item-2', 'Detergent', '1.5', 'daily']
      ]
    );
  });

  it('deletes inventory item under the inventory channel lock', async () => {
    // Given
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([
      getInventorySheetHeaders(),
      ['item-1', 'Coffee beans', '2', 'food']
    ]);
    mockGoogleSheetsService.updateSheetData.mockResolvedValue({ success: true });

    // When
    await repository.delete('channel-1', 'item-1');

    // Then
    expect(mockGoogleSheetsService.runWithLock).toHaveBeenCalledWith(
      'inventory_channel-1',
      expect.any(Function)
    );
    expect(mockGoogleSheetsService.getSheetDataByName).toHaveBeenCalledWith('inventory_channel-1');
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
      'inventory_channel-1',
      [getInventorySheetHeaders()]
    );
  });
});
