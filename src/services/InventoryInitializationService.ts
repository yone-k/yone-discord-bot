import type { InventoryChannelStore } from './InventoryChannelStore';
import { OutputApi } from '../api/OutputApi';
import { DEFAULT_CATEGORY } from '../models/CategoryType';

export interface InitializationContext {
  channelId: string;
  listTitle: string;
}

export interface InventoryInitializationResult {
  success: true;
}

export class InventoryInitializationService {
  constructor(
    private metadataManager: InventoryChannelStore,
    private outputs: Pick<OutputApi, 'initialize'> = new OutputApi()
  ) {}

  public async initializeInventory(
    context: InitializationContext
  ): Promise<InventoryInitializationResult> {
    const current = await this.metadataManager.getChannelMetadata(context.channelId);
    if (!current) await this.metadataManager.createChannelMetadata(context.channelId, { listTitle: context.listTitle, defaultCategory: DEFAULT_CATEGORY });
    await this.outputs.initialize(context.channelId, { kind: 'inventory' });

    return { success: true };
  }
}
