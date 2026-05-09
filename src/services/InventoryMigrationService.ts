import { randomUUID } from 'crypto';
import type { OperationResult } from './GoogleSheetsService';
import { GoogleSheetsService as GoogleSheetsServiceClass } from './GoogleSheetsService';
import { InventoryMetadataManager, type InventoryChannelMetadata } from './InventoryMetadataManager';
import { RemindMetadataManager } from './RemindMetadataManager';
import { InventoryRepository } from './InventoryRepository';
import { RemindTaskRepository } from './RemindTaskRepository';
import type { InventoryItem } from '../models/InventoryItem';
import {
  isNewInventoryItem,
  type LegacyRemindInventoryItem,
  type NewRemindInventoryItem,
  type RemindTask
} from '../models/RemindTask';
import { parseLegacyInventoryItemsForMigration } from '../utils/RemindSheetMapper';

export interface ConflictItem {
  name: string;
  stockValues: number[];
  resolvedStock: number;
}

export interface SkippedTask {
  taskId: string;
  reason: string;
}

export interface MigrationReport {
  success: boolean;
  message?: string;
  backupSheets: string[];
  migratedTasks: number;
  mergedItems: number;
  conflictItems: ConflictItem[];
  skippedTasks: SkippedTask[];
}

interface InventoryMetadataReader {
  getChannelMetadata(channelId: string): Promise<InventoryChannelMetadata | null>;
}

interface RemindMetadataReader {
  findChannelsLinkedToInventory(inventoryChannelId: string): Promise<string[]>;
}

interface BackupSheetService {
  createSheetByName(sheetName: string): Promise<OperationResult>;
  getSheetDataByName(sheetName: string): Promise<string[][]>;
  appendSheetData(sheetName: string, data: (string | number)[][]): Promise<OperationResult>;
}

interface InventoryRepositoryForMigration {
  findByName(channelId: string, name: string): Promise<InventoryItem | null>;
  append(channelId: string, item: InventoryItem): Promise<OperationResult>;
  update(channelId: string, item: InventoryItem): Promise<OperationResult>;
}

interface RemindTaskRepositoryForMigration {
  fetchTasks(channelId: string): Promise<RemindTask[]>;
  updateTask(channelId: string, task: RemindTask): Promise<OperationResult>;
}

interface LegacyTaskMigration {
  channelId: string;
  task: RemindTask;
  legacyItems: LegacyRemindInventoryItem[];
}

export class InventoryMigrationService {
  constructor(
    private readonly inventoryMetadataManager: InventoryMetadataReader = InventoryMetadataManager.getInstance(),
    private readonly remindMetadataManager: RemindMetadataReader = RemindMetadataManager.getInstance(),
    private readonly googleSheetsService: BackupSheetService = GoogleSheetsServiceClass.getInstance(),
    private readonly inventoryRepository: InventoryRepositoryForMigration = new InventoryRepository(),
    private readonly remindTaskRepository: RemindTaskRepositoryForMigration = new RemindTaskRepository()
  ) {}

  public async migrate(inventoryChannelId: string): Promise<MigrationReport> {
    const report = this.createInitialReport();
    const metadata = await this.inventoryMetadataManager.getChannelMetadata(inventoryChannelId);
    if (!metadata) {
      return {
        ...report,
        success: false,
        message: '在庫チャンネルが未初期化です。/init-inventory を実行してください。'
      };
    }

    const taskChannelIds = await this.remindMetadataManager.findChannelsLinkedToInventory(inventoryChannelId);
    if (taskChannelIds.length === 0) {
      return { ...report, success: true };
    }

    const backupResult = await this.backupTaskSheets(taskChannelIds, report.backupSheets);
    if (!backupResult.success) {
      return {
        ...report,
        success: false,
        message: backupResult.message
      };
    }

    const migrationTargets = await this.collectMigrationTargets(taskChannelIds, report.skippedTasks);
    const inventoryIdByName = await this.upsertInventoryItems(
      inventoryChannelId,
      metadata.defaultCategory,
      migrationTargets,
      report.conflictItems
    );

    for (const target of migrationTargets) {
      const inventoryItems = target.legacyItems.map((item): NewRemindInventoryItem => ({
        inventoryId: inventoryIdByName.get(item.name) ?? '',
        consume: item.consume
      }));
      await this.remindTaskRepository.updateTask(target.channelId, {
        ...target.task,
        inventoryItems
      });
    }

    return {
      ...report,
      success: true,
      migratedTasks: migrationTargets.length,
      mergedItems: inventoryIdByName.size
    };
  }

  private createInitialReport(): MigrationReport {
    return {
      success: false,
      backupSheets: [],
      migratedTasks: 0,
      mergedItems: 0,
      conflictItems: [],
      skippedTasks: []
    };
  }

  private async backupTaskSheets(
    taskChannelIds: string[],
    backupSheets: string[]
  ): Promise<{ success: boolean; message?: string }> {
    const timestamp = this.formatTimestamp(new Date());

    for (const channelId of taskChannelIds) {
      const sourceSheet = `remind_list_${channelId}`;
      const backupSheet = `${sourceSheet}_backup_${timestamp}`;
      const createResult = await this.googleSheetsService.createSheetByName(backupSheet);
      if (!createResult.success) {
        return {
          success: false,
          message: `バックアップの作成に失敗しました。${createResult.message ?? ''}`.trim()
        };
      }

      backupSheets.push(backupSheet);
      const data = await this.googleSheetsService.getSheetDataByName(sourceSheet);
      const appendResult = await this.googleSheetsService.appendSheetData(backupSheet, data);
      if (!appendResult.success) {
        return {
          success: false,
          message: `バックアップのコピーに失敗しました。${appendResult.message ?? ''}`.trim()
        };
      }
    }

    return { success: true };
  }

  private async collectMigrationTargets(
    taskChannelIds: string[],
    skippedTasks: SkippedTask[]
  ): Promise<LegacyTaskMigration[]> {
    const targets: LegacyTaskMigration[] = [];

    for (const channelId of taskChannelIds) {
      const tasks = await this.remindTaskRepository.fetchTasks(channelId);
      for (const task of tasks) {
        if (task.inventoryItems.some(item => isNewInventoryItem(item))) {
          skippedTasks.push({
            taskId: task.id,
            reason: '既に移行済みです'
          });
          continue;
        }

        const legacyItems = parseLegacyInventoryItemsForMigration(JSON.stringify(task.inventoryItems));
        if (legacyItems.length === 0) {
          continue;
        }

        targets.push({ channelId, task, legacyItems });
      }
    }

    return targets;
  }

  private async upsertInventoryItems(
    inventoryChannelId: string,
    defaultCategory: string,
    migrationTargets: LegacyTaskMigration[],
    conflictItems: ConflictItem[]
  ): Promise<Map<string, string>> {
    const groupedItems = new Map<string, LegacyRemindInventoryItem[]>();
    for (const target of migrationTargets) {
      for (const item of target.legacyItems) {
        const items = groupedItems.get(item.name) ?? [];
        items.push(item);
        groupedItems.set(item.name, items);
      }
    }

    const inventoryIdByName = new Map<string, string>();
    for (const [name, items] of groupedItems) {
      const stockValues = items.map(item => item.stock);
      const resolvedStock = Math.max(...stockValues);
      if (items.length > 1) {
        conflictItems.push({ name, stockValues, resolvedStock });
      }

      const existing = await this.inventoryRepository.findByName(inventoryChannelId, name);
      if (existing) {
        const updated = {
          ...existing,
          stock: Math.max(existing.stock, resolvedStock)
        };
        await this.inventoryRepository.update(inventoryChannelId, updated);
        inventoryIdByName.set(name, existing.id);
        continue;
      }

      const item: InventoryItem = {
        id: randomUUID(),
        name,
        stock: resolvedStock,
        category: defaultCategory
      };
      await this.inventoryRepository.append(inventoryChannelId, item);
      inventoryIdByName.set(name, item.id);
    }

    return inventoryIdByName;
  }

  private formatTimestamp(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }
}
