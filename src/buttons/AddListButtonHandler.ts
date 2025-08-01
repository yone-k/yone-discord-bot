import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataManager } from '../services/MetadataManager';

export class AddListButtonHandler extends BaseButtonHandler {
  constructor(
    logger: Logger, 
    operationLogService?: OperationLogService,
    metadataManager?: MetadataManager
  ) {
    super('add-list-button', logger, operationLogService, metadataManager);
    this.ephemeral = true;
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'add',
      actionName: 'アイテム追加'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const userId = context.interaction.user.id;

    if (!channelId) {
      throw new Error('チャンネルIDが取得できません');
    }

    this.logger.info('Showing add-list modal', {
      channelId,
      userId
    });

    try {
      await this.showAddListModal(context);
      return {
        success: true,
        message: '追加モーダルを表示しました',
        affectedItems: 1,
        details: {
          items: [{
            name: '新しいアイテム',
            quantity: 1,
            category: 'その他',
            until: undefined
          }]
        }
      };
    } catch (error) {
      return {
        success: false,
        message: 'モーダル表示に失敗しました',
        error: error instanceof Error ? error : new Error('未知のエラー')
      };
    }
  }

  private async showAddListModal(context: ButtonHandlerContext): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId('add-list-modal')
      .setTitle('リストに項目を追加');

    // カテゴリーフィールド（省略可）
    const categoryInput = new TextInputBuilder()
      .setCustomId('category')
      .setLabel('カテゴリー（省略可）')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('例: 食品、日用品、その他')
      .setRequired(false)
      .setMaxLength(50);

    // アイテムフィールド（必須）
    const itemsInput = new TextInputBuilder()
      .setCustomId('items')
      .setLabel('名前,期限（1行に1つずつ記入）')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('例:\n牛乳,2024-12-31\nパン\nシャンプー,2024-06-30')
      .setRequired(true)
      .setMaxLength(4000);

    const categoryRow = new ActionRowBuilder<TextInputBuilder>()
      .addComponents(categoryInput);

    const itemsRow = new ActionRowBuilder<TextInputBuilder>()
      .addComponents(itemsInput);

    modal.addComponents(categoryRow, itemsRow);

    await context.interaction.showModal(modal);
  }
}