import { ComponentType, MessageFlags } from 'discord.js';
import type { APIComponentInContainer, APIMessageTopLevelComponent, APITextDisplayComponent } from 'discord-api-types/v10';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { RemindTaskFormatter } from '../ui/RemindTaskFormatter';

export class RemindTaskDetailButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;

  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository
  ) {
    super('remind-task-detail', logger, operationLogService, metadataManager);
    this.ephemeral = true;
    this.repository = repository || new RemindTaskRepository();
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'detail',
      actionName: 'リマインド詳細'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const interaction = context.interaction;
    const channelId = interaction.channelId;
    const messageId = interaction.message?.id;

    const reply = async (components: APIMessageTopLevelComponent[]): Promise<void> => {
      const payload = {
        components,
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(payload);
      } else {
        await interaction.reply(payload);
      }
    };

    if (!channelId || !messageId) {
      await reply([this.buildTextContainer(['チャンネル情報が取得できません'])]);
      return { success: false, message: 'チャンネル情報が取得できません' };
    }

    const task = await this.repository.findTaskByMessageId(channelId, messageId);
    if (!task) {
      await reply([this.buildTextContainer(['タスクが見つかりません'])]);
      return { success: false, message: 'タスクが見つかりません' };
    }

    const now = new Date();
    const summary = RemindTaskFormatter.formatSummaryText(task, now);
    const progressBlock = `\`\`\`\n${summary.progressBar}\n\`\`\``;
    const detailText = RemindTaskFormatter.formatDetailText(task, now);
    const descriptionText = task.description?.trim() || '（なし）';

    const components = this.buildTextContainer([
      `## ${task.title}`,
      progressBlock,
      detailText,
      `説明: ${descriptionText}`
    ]);

    await reply([components]);

    return { success: true };
  }

  private buildTextContainer(lines: string[]): APIMessageTopLevelComponent {
    const components: APIComponentInContainer[] = lines
      .filter((line) => line.trim() !== '')
      .map((line) => this.buildTextDisplay(line));

    return {
      type: ComponentType.Container,
      components
    };
  }

  private buildTextDisplay(content: string): APITextDisplayComponent {
    return {
      type: ComponentType.TextDisplay,
      content
    };
  }
}
