import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';

export class RemindTaskUpdateButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository
  ) {
    super('remind-task-update', logger, operationLogService, metadataManager);
    this.repository = repository || new RemindTaskRepository();
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: 'リマインド更新'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const messageId = context.interaction.message?.id;
    if (!channelId || !messageId) {
      return { success: false, message: 'チャンネル情報が取得できません' };
    }

    const task = await this.repository.findTaskByMessageId(channelId, messageId);
    if (!task) {
      return { success: false, message: 'タスクが見つかりません' };
    }

    const basicButton = new ButtonBuilder()
      .setCustomId(`remind-task-update-basic:${messageId}`)
      .setLabel('基本編集')
      .setStyle(ButtonStyle.Primary);

    const overrideButton = new ButtonBuilder()
      .setCustomId(`remind-task-update-override:${messageId}`)
      .setLabel('期限上書き')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(basicButton, overrideButton);

    await context.interaction.reply({
      content: '更新内容を選択してください。',
      components: [row]
    });

    return { success: true, message: '更新選択を表示しました' };
  }
}
