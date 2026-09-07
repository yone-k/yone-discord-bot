import type { InventoryItem } from '../models/InventoryItem';
import { InventoryRepository } from './InventoryRepository';
import type { OperationResult } from '../api/contracts';
import { CoreApiError } from '../api/CoreClient';

export interface ShortageItem { inventoryId: string; name: string; required: string; available: string }
export class InventoryService {
  private static instance: InventoryService | undefined;
  constructor(private readonly inventoryRepository: Pick<InventoryRepository, 'resolveByName' | 'findById' | 'append' | 'appendMany' | 'update' | 'delete'>) {}
  /** Returns names skipped because an item with the same name already exists. */
  createMany(channelId: string, items: Omit<InventoryItem, 'id'>[]): Promise<string[]> {
    return this.inventoryRepository.appendMany(channelId, items);
  }
  static getInstance(): InventoryService {
    return this.instance ??= new InventoryService(new InventoryRepository());
  }
  resolveByName(channelId: string, name: string): Promise<InventoryItem> { return this.inventoryRepository.resolveByName(channelId, name); }
  getById(channelId: string, id: string): Promise<InventoryItem | null> { return this.inventoryRepository.findById(channelId, id); }
  async create(channelId: string, item: Omit<InventoryItem, 'id'>): Promise<OperationResult> {
    try { return await this.inventoryRepository.append(channelId, item); }
    catch (error) {
      if (error instanceof CoreApiError && error.code === 'invalid_input' && error.details?.reason === 'duplicate_name') {
        return { success: false, message: '同名のアイテムが既に存在します' };
      }
      throw error;
    }
  }
  update(channelId: string, item: InventoryItem): Promise<OperationResult> { return this.inventoryRepository.update(channelId, item); }
  async delete(channelId: string, id: string): Promise<void> { await this.inventoryRepository.delete(channelId, id); }
}
