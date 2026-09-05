import { randomUUID } from 'node:crypto';
import type { InventoryItem } from '../models/InventoryItem';
import type { NewRemindInventoryItem, RemindTask } from '../models/RemindTask';
import { InventoryRepository } from './InventoryRepository';
import type { OperationResult } from '../repositories/contracts';
import { compareDecimal } from '../utils/Decimal';
import { RemindChannelStore } from './RemindChannelStore';
import { RemindTaskRepository } from './RemindTaskRepository';

type InventoryRepositoryPort = Pick<
  InventoryRepository,
  'findByName' | 'findById' | 'append' | 'update' | 'bulkUpdate' | 'delete' | 'fetchAll'
>;
type RemindChannelStorePort = Pick<RemindChannelStore, 'getChannelMetadata'>;
type RemindTaskRepositoryPort = Pick<RemindTaskRepository, 'referencingInventory'>;

export interface ShortageItem {
  inventoryId: string;
  name: string;
  required: string;
  available: string;
}

export type ConsumeForTaskResult =
  | { kind: 'success'; linkedInventoryChannelId?: string }
  | { kind: 'shortage'; items: ShortageItem[] }
  | { kind: 'error'; message: string };

export interface ReferencedTask {
  channelId: string;
  title: string;
}

export class InventoryService {
  private static instance: InventoryService | undefined;

  constructor(
    private readonly inventoryRepository: InventoryRepositoryPort,
    private readonly remindMetadataManager: RemindChannelStorePort,
    private readonly remindTaskRepository: RemindTaskRepositoryPort
  ) {}

  public static getInstance(): InventoryService {
    if (!InventoryService.instance) {
      InventoryService.instance = new InventoryService(
        new InventoryRepository(),
        RemindChannelStore.getInstance(),
        new RemindTaskRepository()
      );
    }
    return InventoryService.instance;
  }

  public async resolveByName(channelId: string, name: string): Promise<InventoryItem> {
    const existing = await this.inventoryRepository.findByName(channelId, name);
    if (existing) {
      return existing;
    }

    const item: InventoryItem = {
      id: randomUUID(),
      name,
      stock: '0',
      category: ''
    };
    await this.inventoryRepository.append(channelId, item);
    return item;
  }

  public async getById(channelId: string, id: string): Promise<InventoryItem | null> {
    return this.inventoryRepository.findById(channelId, id);
  }

  public async checkShortageForTask(taskChannelId: string, task: RemindTask): Promise<ConsumeForTaskResult> {
    const metadataResult = await this.remindMetadataManager.getChannelMetadata(taskChannelId);
    const linkedInventoryChannelId = metadataResult.metadata?.linkedInventoryChannelId;
    if (!linkedInventoryChannelId) {
      return { kind: 'success' };
    }

    const shortages = await this.collectShortages(
      linkedInventoryChannelId,
      task.inventoryItems
    );
    return shortages.length > 0
      ? { kind: 'shortage', items: shortages }
      : { kind: 'success' };
  }

  public async create(channelId: string, item: InventoryItem): Promise<OperationResult> {
    const existing = await this.inventoryRepository.findByName(channelId, item.name);
    if (existing) {
      return { success: false, message: '同名のアイテムが既に存在します' };
    }

    return this.inventoryRepository.append(channelId, item);
  }

  public async update(channelId: string, item: InventoryItem): Promise<OperationResult> {
    const target = await this.inventoryRepository.findById(channelId, item.id);
    if (!target) {
      return { success: false, message: 'アイテムが見つかりません' };
    }

    const duplicate = await this.inventoryRepository.findByName(channelId, item.name);
    if (duplicate && duplicate.id !== item.id) {
      return { success: false, message: '同名のアイテムが既に存在します' };
    }

    return this.inventoryRepository.update(channelId, item);
  }

  public async delete(channelId: string, id: string): Promise<void> {
    const references = await this.findReferencingTasks(channelId, id);

    if (references.length > 0) {
      const referenceLines = references.map(reference => `- ${reference.channelId}: ${reference.title}`).join('\n');
      throw new Error(`在庫アイテムを削除できません: 参照中のタスクがあります\n${referenceLines}`);
    }

    await this.inventoryRepository.delete(channelId, id);
  }

  public async findReferencingTasks(channelId: string, id: string): Promise<ReferencedTask[]> {
    const tasks = await this.remindTaskRepository.referencingInventory(channelId, id);
    return tasks.map(task => ({ channelId: task.channelId, title: task.title }));
  }

  private async collectShortages(
    linkedInventoryChannelId: string,
    inventoryItems: NewRemindInventoryItem[]
  ): Promise<ShortageItem[]> {
    const inventory = await this.inventoryRepository.fetchAll(linkedInventoryChannelId);
    const inventoryById = new Map(inventory.map(item => [item.id, item]));
    const shortages: ShortageItem[] = [];

    for (const request of inventoryItems) {
      const item = inventoryById.get(request.inventoryId);
      if (!item) {
        shortages.push({
          inventoryId: request.inventoryId,
          name: request.inventoryId,
          required: request.consume,
          available: '0'
        });
        continue;
      }

      if (compareDecimal(item.stock, request.consume) < 0) {
        shortages.push({
          inventoryId: request.inventoryId,
          name: item.name,
          required: request.consume,
          available: item.stock
        });
      }
    }

    return shortages;
  }

}
