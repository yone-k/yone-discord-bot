import { ChatInputCommandInteraction, ThreadChannel } from 'discord.js';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';

export interface CommandExecutionContext {
  interaction?: ChatInputCommandInteraction
  userId?: string
  guildId?: string
  channelId?: string
  thread?: ThreadChannel
}

export interface CommandExecutionResult {
  success: boolean
  executionTime: number
  error?: CommandError
}

export abstract class BaseCommand {
  protected readonly name: string;
  protected readonly description: string;
  protected readonly logger: Logger;
  protected useThread: boolean = true;
  protected deleteOnSuccess: boolean = false;
  protected threadConfig?: {
    name?: string;
    autoArchiveDuration?: number;
  };

  constructor(name: string, description: string, logger: Logger) {
    this.name = name;
    this.description = description;
    this.logger = logger;
  }

  abstract execute(context?: CommandExecutionContext): Promise<void>

  public async safeExecute(context?: CommandExecutionContext): Promise<CommandExecutionResult> {
    const startTime = performance.now();
    
    try {
      this.logger.info(`Executing command "${this.name}"`, { 
        userId: context?.userId,
        guildId: context?.guildId,
        channelId: context?.channelId
      });

      let executionContext = context;
      
      if (this.useThread && context?.interaction) {
        const thread = await this.createThread(context.interaction);
        executionContext = { ...context, thread };
      }

      await this.execute(executionContext);
      
      // コマンド成功時、削除オプションが有効な場合はスレッド全体と初期メッセージを削除
      if (this.deleteOnSuccess && this.useThread && context?.interaction) {
        try {
          // スレッドがある場合はスレッドを削除
          if (executionContext?.thread) {
            await executionContext.thread.delete();
          }
          
          // 初期応答メッセージも削除
          const message = await context.interaction.fetchReply();
          await message.delete();
        } catch (deleteError) {
          this.logger.warn(`Failed to delete thread or message for command "${this.name}"`, {
            error: deleteError instanceof Error ? deleteError.message : String(deleteError)
          });
        }
      }
      
      const executionTime = performance.now() - startTime;
      
      this.logger.info(`Command "${this.name}" completed successfully`, { 
        executionTime: `${executionTime.toFixed(2)}ms`,
        userId: context?.userId
      });

      return {
        success: true,
        executionTime
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      
      let commandError: CommandError;

      if (error instanceof CommandError) {
        commandError = error;
      } else if (error instanceof Error) {
        commandError = new CommandError(
          CommandErrorType.EXECUTION_FAILED,
          this.name,
          `Command execution failed: ${error.message}`,
          undefined,
          error
        );
      } else {
        commandError = new CommandError(
          CommandErrorType.EXECUTION_FAILED,
          this.name,
          'Unknown error occurred during command execution'
        );
      }

      this.logger.error(`Command "${this.name}" failed`, {
        error: commandError.getErrorDetails(),
        executionTime: `${executionTime.toFixed(2)}ms`,
        userId: context?.userId
      });

      return {
        success: false,
        executionTime,
        error: commandError
      };
    }
  }

  getName(): string {
    return this.name;
  }

  getDescription(): string {
    return this.description;
  }

  private async createThread(interaction: ChatInputCommandInteraction): Promise<ThreadChannel> {
    const threadName = this.threadConfig?.name || `${this.name}実行結果`;
    const autoArchiveDuration = this.threadConfig?.autoArchiveDuration || 60;
    
    // まず初期応答をdefer
    await interaction.deferReply();
    
    // 返信メッセージを取得してスレッドを作成
    const message = await interaction.fetchReply();
    
    return await message.startThread({
      name: threadName,
      autoArchiveDuration: autoArchiveDuration as 60 | 1440 | 4320 | 10080
    });
  }
}