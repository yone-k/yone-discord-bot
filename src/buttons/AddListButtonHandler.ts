import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

export class AddListButtonHandler extends BaseButtonHandler {
  constructor(logger: Logger) {
    super('add-list-button', logger);
    this.ephemeral = true;
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<void> {
    const channelId = context.interaction.channelId;
    const userId = context.interaction.user.id;

    if (!channelId) {
      throw new Error('チャンネルIDが取得できません');
    }

    this.logger.info('Showing add-list modal', {
      channelId,
      userId
    });

    await this.showAddListModal(context);
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