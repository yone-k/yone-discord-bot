import { randomUUID } from 'node:crypto';
import type { InventoryItem } from '../models/InventoryItem';
import type { NewRemindInventoryItem, RemindTask } from '../models/RemindTask';
import { isLegacyInventoryItem } from '../models/RemindTask';
import { InventoryRepository } from './InventoryRepository';
import { GoogleSheetsService, type OperationResult } from './GoogleSheetsService';
import { RemindMetadataManager } from './RemindMetadataManager';
import { RemindTaskRepository } from './RemindTaskRepository';

type InventoryRepositoryPort = Pick<InventoryRepository, 'findByName' | 'findById' | 'append' | 'update' | 'delete'>;
type RemindMetadataManagerPort = Pick<RemindMetadataManager, 'findChannelsLinkedToInventory' | 'getChannelMetadata'>;
type RemindTaskRepositoryPort = Pick<RemindTaskRepository, 'fetchTasks'>;
type GoogleSheetsServicePort = Pick<GoogleSheetsService, 'runWithLock'>;

export interface ShortageItem {
  inventoryId: string;
  name: string;
  required: number;
  available: number;
}

export type ConsumeForTaskResult =
  | { kind: 'success'; linkedInventoryChannelId?: string }
  | { kind: 'shortage'; items: ShortageItem[] }
  | { kind: 'migration_required' };

interface ReferencedTask {
  channelId: string;
  title: string;
}

export class InventoryService {
  private static instance: InventoryService | undefined;

  constructor(
    private readonly inventoryRepository: InventoryRepositoryPort,
    private readonly remindMetadataManager: RemindMetadataManagerPort,
    private readonly remindTaskRepository: RemindTaskRepositoryPort,
    private readonly googleSheetsService: GoogleSheetsServicePort
  ) {}

  public static getInstance(): InventoryService {
    if (!InventoryService.instance) {
      InventoryService.instance = new InventoryService(
        new InventoryRepository(),
        RemindMetadataManager.getInstance(),
        new RemindTaskRepository(),
        GoogleSheetsService.getInstance()
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
      stock: 0,
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

    if (task.inventoryItems.some(isLegacyInventoryItem)) {
      return { kind: 'migration_required' };
    }

    const shortages = await this.collectShortages(
      linkedInventoryChannelId,
      task.inventoryItems as NewRemindInventoryItem[]
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
    const taskChannelIds = await this.remindMetadataManager.findChannelsLinkedToInventory(channelId);
    const references: ReferencedTask[] = [];

    for (const taskChannelId of taskChannelIds) {
      const tasks = await this.remindTaskRepository.fetchTasks(taskChannelId);
      references.push(...this.findReferencedTasks(taskChannelId, tasks, id));
    }

    if (references.length > 0) {
      const referenceLines = references.map(reference => `- ${reference.channelId}: ${reference.title}`).join('\n');
      throw new Error(`在庫アイテムを削除できません: 参照中のタスクがあります\n${referenceLines}`);
    }

    await this.inventoryRepository.delete(channelId, id);
  }

  public async consumeForTask(taskChannelId: string, task: RemindTask): Promise<ConsumeForTaskResult> {
    const metadataResult = await this.remindMetadataManager.getChannelMetadata(taskChannelId);
    const linkedInventoryChannelId = metadataResult.metadata?.linkedInventoryChannelId;
    if (!linkedInventoryChannelId) {
      return { kind: 'success' };
    }

    if (task.inventoryItems.some(isLegacyInventoryItem)) {
      return { kind: 'migration_required' };
    }

    const inventoryItems = task.inventoryItems as NewRemindInventoryItem[];
    return this.googleSheetsService.runWithLock(
      `inventory_${linkedInventoryChannelId}`,
      async () => this.consumeInventoryItems(linkedInventoryChannelId, inventoryItems)
    );
  }

  private findReferencedTasks(channelId: string, tasks: RemindTask[], inventoryId: string): ReferencedTask[] {
    return tasks
      .filter(task => task.inventoryItems.some(item => 'inventoryId' in item && item.inventoryId === inventoryId))
      .map(task => ({
        channelId,
        title: task.title
      }));
  }

  private async consumeInventoryItems(
    linkedInventoryChannelId: string,
    inventoryItems: NewRemindInventoryItem[]
  ): Promise<ConsumeForTaskResult> {
    const { stockedItems, shortages } = await this.collectInventoryState(linkedInventoryChannelId, inventoryItems);

    if (shortages.length > 0) {
      return { kind: 'shortage', items: shortages };
    }

    for (const stockedItem of stockedItems) {
      await this.inventoryRepository.update(linkedInventoryChannelId, {
        ...stockedItem.item,
        stock: stockedItem.item.stock - stockedItem.request.consume
      }, { useLock: false });
    }

    return { kind: 'success', linkedInventoryChannelId };
  }

  private async collectShortages(
    linkedInventoryChannelId: string,
    inventoryItems: NewRemindInventoryItem[]
  ): Promise<ShortageItem[]> {
    const shortages: ShortageItem[] = [];

    for (const request of inventoryItems) {
      const item = await this.inventoryRepository.findById(linkedInventoryChannelId, request.inventoryId);
      if (!item) {
        shortages.push({
          inventoryId: request.inventoryId,
          name: request.inventoryId,
          required: request.consume,
          available: 0
        });
        continue;
      }

      if (item.stock < request.consume) {
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

  private async collectInventoryState(
    linkedInventoryChannelId: string,
    inventoryItems: NewRemindInventoryItem[]
  ): Promise<{
      stockedItems: Array<{ request: NewRemindInventoryItem; item: InventoryItem }>;
      shortages: ShortageItem[];
    }> {
    const stockedItems: Array<{ request: NewRemindInventoryItem; item: InventoryItem }> = [];
    const shortages: ShortageItem[] = [];

    for (const request of inventoryItems) {
      const item = await this.inventoryRepository.findById(linkedInventoryChannelId, request.inventoryId);
      if (!item) {
        shortages.push({
          inventoryId: request.inventoryId,
          name: request.inventoryId,
          required: request.consume,
          available: 0
        });
        continue;
      }

      if (item.stock < request.consume) {
        shortages.push({
          inventoryId: request.inventoryId,
          name: item.name,
          required: request.consume,
          available: item.stock
        });
      }

      stockedItems.push({ request, item });
    }

    return { stockedItems, shortages };
  }
}
