import { ModalSubmitInteraction } from 'discord.js';
import { Logger } from '../utils/logger';

export interface ModalHandlerContext {
  interaction: ModalSubmitInteraction;
}

export abstract class BaseModalHandler {
  protected readonly customId: string;
  protected readonly logger: Logger;
  protected ephemeral: boolean = true;
  protected deleteOnSuccess: boolean = false;

  constructor(customId: string, logger: Logger) {
    this.customId = customId;
    this.logger = logger;
  }

  public async handle(context: ModalHandlerContext): Promise<void> {
    try {
      if (!this.shouldHandle(context)) {
        return;
      }

      await context.interaction.deferReply({ ephemeral: this.ephemeral });

      await this.executeAction(context);

      // 成功時にメッセージを削除
      if (this.deleteOnSuccess) {
        try {
          await context.interaction.editReply({ content: '処理が完了しました。' });
          try {
            const reply = await context.interaction.fetchReply();
            await reply.delete();
          } catch (delayedDeleteError) {
            this.logger.warn('Failed to delete success message', {
              error: delayedDeleteError instanceof Error ? delayedDeleteError.message : 'Unknown error',
              customId: this.customId
            });
          }
        } catch (deleteError) {
          this.logger.warn('Failed to delete success message', {
            error: deleteError instanceof Error ? deleteError.message : 'Unknown error',
            customId: this.customId
          });
        }
      } else {
        await context.interaction.editReply({
          content: this.getSuccessMessage()
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle modal submission for customId "${this.customId}"`,
        { 
          error: error instanceof Error ? error.message : 'Unknown error',
          userId: context.interaction.user.id,
          guildId: context.interaction.guildId,
          channelId: context.interaction.channelId
        }
      );
      
      try {
        await context.interaction.editReply({
          content: '❌ 処理中にエラーが発生しました。しばらく時間を置いてから再試行してください。'
        });
      } catch (replyError) {
        this.logger.error('Failed to send modal response', {
          error: replyError instanceof Error ? replyError.message : 'Unknown error'
        });
      }
    }
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId === this.customId;
  }

  public getCustomId(): string {
    return this.customId;
  }

  protected abstract executeAction(context: ModalHandlerContext): Promise<void>;

  protected abstract getSuccessMessage(): string;
}