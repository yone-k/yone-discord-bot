import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { ListRepository } from '../api/contracts';
import { ApiListRepository } from '../api/Repositories';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { ListChannelStore } from '../services/ListChannelStore';
import { serializeListCsv } from '../utils/ListInput';
import { DEFAULT_CATEGORY } from '../models/CategoryType';
export class EditListButtonHandler extends BaseButtonHandler {
  constructor(logger: Logger, operationLogService?: OperationLogService, metadataManager?: ListChannelStore, private repository: ListRepository = new ApiListRepository()) {
    super('edit-list-button', logger, operationLogService, metadataManager);
  }
  protected getOperationInfo(): OperationInfo { return { operationType: 'edit', actionName: 'アイテム編集' }; }
  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    try {
      const { interaction } = context;
      if (!interaction.channelId)
        throw new Error('チャンネルIDが取得できません');
      const [snapshot, defaultCategory] = await Promise.all([
        this.repository.snapshot(interaction.channelId),
        this.getDefaultCategory(interaction.channelId)
      ]);
      const csv = serializeListCsv(snapshot.items, defaultCategory);
      if (csv.length > 4000)
        throw new Error('編集画面の上限4000文字を超えています');
      const input = new TextInputBuilder().setCustomId('list-data').setLabel('名前,カテゴリ,期限(YYYY-MM-DD),完了(0/1)')
        .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000);
      if (csv)
        input.setValue(csv);
      const modal = new ModalBuilder().setCustomId(`edit-list-modal:${interaction.channelId}:${interaction.user.id}:${snapshot.editVersion}`)
        .setTitle('リスト編集').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
      await interaction.showModal(modal);
      return { success: true, message: '編集モーダルを表示しました' };
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '編集画面を開けませんでした';
      if (!context.interaction.replied && !context.interaction.deferred) {
        await context.interaction.reply({ content: message, flags: ['Ephemeral'] });
      }
      return { success: false, message };
    }
  }
  private async getDefaultCategory(channelId: string): Promise<string> {
    try {
      const result = await (this.metadataManager ?? ListChannelStore.getInstance()).getChannelMetadata(channelId);
      if (result.success && result.metadata) return result.metadata.defaultCategory?.trim() || DEFAULT_CATEGORY;
      this.logger.warn('リスト編集のカテゴリ設定が見つかりません', { channelId });
    } catch {
      this.logger.warn('リスト編集のカテゴリ設定を取得できません', { channelId });
    }
    return DEFAULT_CATEGORY;
  }
}
