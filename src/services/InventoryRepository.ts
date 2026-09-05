import type { InventoryItem } from '../models/InventoryItem';
import type { InventoryRepository as InventoryPort, StoredInventoryItem, OperationResult } from '../repositories/contracts';
import { PostgresInventoryRepository } from '../repositories/PostgresInventoryRepository';

const fromStored = (item: StoredInventoryItem): InventoryItem => ({ id: item.id, name: item.name, stock: item.stock, category: item.category ?? '' });
const toStored = (item: InventoryItem): Omit<StoredInventoryItem, 'channelId' | 'position'> => ({ ...item, category: item.category || null });

export class InventoryRepository {
  constructor(private readonly repository: InventoryPort = new PostgresInventoryRepository()) {}
  async apply(channelId: string, expected: InventoryItem[], items: InventoryItem[]): Promise<void> {
    await this.repository.apply(channelId, expected.map(toStored), items.map(toStored));
  }
  async fetchAll(channelId: string): Promise<InventoryItem[]> { return (await this.repository.fetchAll(channelId)).map(fromStored); }
  async findById(channelId: string, id: string): Promise<InventoryItem | null> {
    const item = await this.repository.findById(channelId, id); return item ? fromStored(item) : null;
  }
  async findByName(channelId: string, name: string): Promise<InventoryItem | null> {
    const item = await this.repository.findByName(channelId, name); return item ? fromStored(item) : null;
  }
  async append(channelId: string, item: InventoryItem): Promise<OperationResult> {
    await this.repository.append(channelId, toStored(item)); return { success: true };
  }
  async update(channelId: string, item: InventoryItem): Promise<OperationResult> {
    await this.repository.update(channelId, toStored(item)); return { success: true };
  }
  async bulkUpdate(channelId: string, items: InventoryItem[]): Promise<OperationResult> {
    await this.repository.bulkUpdate(channelId, items.map(toStored)); return { success: true };
  }
  async delete(channelId: string, id: string): Promise<OperationResult> {
    await this.repository.delete(channelId, id); return { success: true };
  }
}
