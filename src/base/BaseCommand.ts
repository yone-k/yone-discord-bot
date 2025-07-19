import { ChatInputCommandInteraction } from 'discord.js';
import { Logger } from '../utils/logger';
import { CommandError, CommandErrorType } from '../utils/CommandError';

export interface CommandExecutionContext {
  interaction?: ChatInputCommandInteraction
  userId?: string
  guildId?: string
  channelId?: string
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

      await this.execute(context);
      
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
}