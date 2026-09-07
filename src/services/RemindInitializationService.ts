import { RemindChannelStore } from './RemindChannelStore';
import { OutputApi } from '../api/OutputApi';

export interface RemindInitializationResult {
  success: true;
}

export class RemindInitializationService {
  constructor(
    private metadataManager: RemindChannelStore = RemindChannelStore.getInstance(),
    private outputs: Pick<OutputApi, 'initialize'> = new OutputApi()
  ) {}

  public async initialize(channelId: string, listTitle: string): Promise<RemindInitializationResult> {
    const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
    if (metadataResult.success) {
      await this.metadataManager.updateChannelMetadata(channelId, { listTitle });
    } else {
      await this.metadataManager.createChannelMetadata(channelId, listTitle);
    }
    await this.outputs.initialize(channelId, { kind: 'reminder' });
    return { success: true };
  }
}
