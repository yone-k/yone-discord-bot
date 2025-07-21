import { BaseCommand, CommandExecutionContext } from '../base/BaseCommand';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';
import { ChannelSheetManager, ChannelSheetResult } from '../services/ChannelSheetManager';

export class InitListCommand extends BaseCommand {
  private channelSheetManager: ChannelSheetManager;

  constructor(logger: Logger, channelSheetManager?: ChannelSheetManager) {
    super('init-list', 'リストの初期化を行います', logger);
    this.channelSheetManager = channelSheetManager || new ChannelSheetManager();
  }

  async execute(context?: CommandExecutionContext): Promise<void> {
    this.logger.debug('Init list command started', {
      userId: context?.userId,
      guildId: context?.guildId
    });

    try {
      this.validateExecutionContext(context);
      
      if (context?.interaction) {
        await context.interaction.deferReply();
      }

      if (context?.channelId) {
        await this.initializeChannelSheet(context);
      } else {
        await this.handleBasicInitialization(context);
      }

      this.logger.debug('Init list command completed');
    } catch (error) {
      this.handleExecutionError(error, context);
    }
  }

  private validateExecutionContext(context?: CommandExecutionContext): void {
    if (context?.interaction && !context.channelId) {
      throw new CommandError(
        CommandErrorType.INVALID_PARAMETERS,
        'init-list',
        'Channel ID is required for list initialization',
        'チャンネルIDが必要です。'
      );
    }
  }

  private async initializeChannelSheet(context: CommandExecutionContext): Promise<void> {
    if (!context.channelId) return;

    this.logger.debug('Initializing sheet for channel', {
      channelId: context.channelId
    });

    await this.verifySheetAccess();
    const result = await this.channelSheetManager.getOrCreateChannelSheet(context.channelId);
    
    this.logInitializationResult(context, result);
    await this.sendSuccessResponse(context, result);
  }

  private async verifySheetAccess(): Promise<void> {
    const hasAccess = await this.channelSheetManager.verifySheetAccess();
    if (!hasAccess) {
      throw new CommandError(
        CommandErrorType.PERMISSION_DENIED,
        'init-list',
        'Sheet access verification failed',
        'スプレッドシートへのアクセス権限がありません。'
      );
    }
  }

  private logInitializationResult(context: CommandExecutionContext, result: ChannelSheetResult): void {
    this.logger.info('List initialization completed', {
      userId: context.userId,
      existed: result.existed,
      created: result.created
    });
  }

  private async sendSuccessResponse(context: CommandExecutionContext, result: ChannelSheetResult): Promise<void> {
    if (!context.interaction) return;

    const message = this.generateSuccessMessage(result);
    await context.interaction.editReply({ content: message });
  }

  private generateSuccessMessage(result: ChannelSheetResult): string {
    if (result.existed) {
      return '📋 既存のリストが見つかりました。初期化は完了しています。';
    } else {
      return '📋 新しいリストを作成し、初期化が完了しました！';
    }
  }

  private async handleBasicInitialization(context?: CommandExecutionContext): Promise<void> {
    this.logger.info('List initialization completed', {
      userId: context?.userId
    });

    if (context?.interaction) {
      await context.interaction.reply({
        content: '📋 リストの初期化が完了しました！',
        ephemeral: false
      });
    }
  }

  private handleExecutionError(error: unknown, context?: CommandExecutionContext): never {
    this.logger.error('Init list command failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: context?.userId,
      channelId: context?.channelId
    });

    if (error instanceof CommandError) {
      throw error;
    }

    throw new CommandError(
      CommandErrorType.EXECUTION_FAILED,
      'init-list',
      `List initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'リストの初期化に失敗しました。しばらく時間を置いてから再試行してください。'
    );
  }
}