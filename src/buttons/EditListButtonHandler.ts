import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { ListRepository } from '../api/contracts';
import { ApiListRepository } from '../api/Repositories';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { ListChannelStore } from '../services/ListChannelStore';
import { serializeListCsv } from '../utils/ListInput';
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
      const snapshot = await this.repository.snapshot(interaction.channelId);
      const csv = serializeListCsv(snapshot.items);
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
}
