import { ChatInputCommandInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { ListInitializationService } from '../services/ListInitializationService';
import { ApiListRepository } from '../api/Repositories';
import { OutputApi } from '../api/OutputApi';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { ListChannelStore } from '../services/ListChannelStore';
import { DEFAULT_CATEGORY } from '../models/CategoryType';
export class InitListButtonHandler extends BaseButtonHandler {
  constructor(logger: Logger, operationLogService?: UiOperationEvents, metadataManager: ListChannelStore = ListChannelStore.getInstance(), private listInitializationService = new ListInitializationService(new ApiListRepository(), new OutputApi(), metadataManager)) {
    super('init-list-button', logger, operationLogService, metadataManager);
    this.ephemeral = true;
    this.deleteOnSuccess = true;
  }
  protected getOperationInfo(): OperationInfo { return { operationType: 'init', actionName: 'リスト再描画' }; }
  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const interaction = context.interaction;
    if (!interaction.channelId)
      return { success: false, message: 'チャンネルIDがありません' };
    await interaction.deferReply({ flags: ['Ephemeral'] });
    try {
      const metadata = await this.metadataManager!.getChannelMetadata(interaction.channelId);
      if (!metadata.metadata)
        throw new Error('リストが初期化されていません');
      const result = await this.listInitializationService.initializeList({ interaction: interaction as unknown as ChatInputCommandInteraction,
        channelId: interaction.channelId, userId: interaction.user.id }, null, metadata.metadata.defaultCategory || DEFAULT_CATEGORY, true);
      await interaction.editReply({ content: '✅ リストを再描画しました' });
      return { success: true, affectedItems: result.itemCount };
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '再描画に失敗しました';
      await interaction.editReply({ content: message });
      return { success: false, message };
    }
  }
}
