import type { Client } from 'discord.js';
import type { GoogleSheetsService } from './GoogleSheetsService';
import type { InventoryMetadataManager } from './InventoryMetadataManager';
import type { InventoryMessageManager } from './InventoryMessageManager';
import { getInventorySheetHeaders } from '../utils/InventorySheetMapper';

export interface InitializationContext {
  channelId: string;
  listTitle: string;
  client: Client;
}

export interface InventoryInitializationResult {
  success: boolean;
  message?: string;
}

export class InventoryInitializationService {
  constructor(
    private googleSheetsService: GoogleSheetsService,
    private metadataManager: InventoryMetadataManager,
    private messageManager: InventoryMessageManager
  ) {}

  public async initializeInventory(
    context: InitializationContext
  ): Promise<InventoryInitializationResult> {
    const sheetName = `inventory_${context.channelId}`;

    const createResult = await this.googleSheetsService.createSheetByName(sheetName);
    const sheetAlreadyExists = createResult.message?.includes('already exists') ?? false;

    if (!createResult.success && !sheetAlreadyExists) {
      return { success: false, message: createResult.message };
    }

    if (createResult.success) {
      const headerResult = await this.googleSheetsService.appendSheetData(
        sheetName,
        [getInventorySheetHeaders()]
      );
      if (!headerResult.success) {
        return { success: false, message: headerResult.message };
      }
    }

    const metadataResult = await this.metadataManager.getOrCreateMetadataSheet();
    if (!metadataResult.success) {
      return { success: false, message: metadataResult.message };
    }

    const messageResult = await this.messageManager.createOrUpdateMessage(
      context.channelId,
      [],
      context.listTitle,
      context.client
    );
    if (!messageResult.success) {
      return { success: false, message: messageResult.errorMessage };
    }

    return { success: true };
  }
}
