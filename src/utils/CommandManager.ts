import { BaseCommand, CommandExecutionContext, CommandExecutionResult } from '../base/BaseCommand';
import { Logger } from './logger';
import { CommandError, CommandErrorType } from './CommandError';

export interface CommandExecutionStats {
  totalExecutions: number
  successfulExecutions: number
  failedExecutions: number
  averageExecutionTime: number
  lastExecutionTime?: Date
}

export class CommandManager {
  private commands: Map<string, BaseCommand>;
  private logger: Logger;
  private stats: Map<string, CommandExecutionStats>;

  constructor(logger: Logger) {
    this.commands = new Map();
    this.logger = logger;
    this.stats = new Map();
  }

  register(command: BaseCommand): void {
    const name = command.getName();
    
    if (this.commands.has(name)) {
      throw new Error(`Command "${name}" is already registered`);
    }
    
    this.commands.set(name, command);
    this.stats.set(name, {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0
    });
    
    this.logger.info(`Command "${name}" registered`);
  }

  getCommand(name: string): BaseCommand | undefined {
    return this.commands.get(name);
  }

  async execute(name: string, context?: CommandExecutionContext): Promise<CommandExecutionResult> {
    const command = this.commands.get(name);
    
    if (!command) {
      const error = new CommandError(
        CommandErrorType.NOT_FOUND,
        name,
        `Command "${name}" not found`,
        `コマンド "${name}" が見つかりませんでした。`
      );
      
      this.logger.warn(`Attempted to execute unknown command: "${name}"`, {
        userId: context?.userId,
        availableCommands: Array.from(this.commands.keys())
      });
      
      return {
        success: false,
        executionTime: 0,
        error
      };
    }
    
    const result = await command.safeExecute(context);
    this.updateStats(name, result);
    
    return result;
  }

  private updateStats(commandName: string, result: CommandExecutionResult): void {
    const currentStats = this.stats.get(commandName);
    if (!currentStats) return;

    const newStats: CommandExecutionStats = {
      totalExecutions: currentStats.totalExecutions + 1,
      successfulExecutions: currentStats.successfulExecutions + (result.success ? 1 : 0),
      failedExecutions: currentStats.failedExecutions + (result.success ? 0 : 1),
      averageExecutionTime: this.calculateNewAverage(
        currentStats.averageExecutionTime,
        currentStats.totalExecutions,
        result.executionTime
      ),
      lastExecutionTime: new Date()
    };

    this.stats.set(commandName, newStats);
  }

  private calculateNewAverage(
    currentAverage: number,
    currentCount: number,
    newValue: number
  ): number {
    return (currentAverage * currentCount + newValue) / (currentCount + 1);
  }

  getAllCommands(): BaseCommand[] {
    return Array.from(this.commands.values());
  }

  getCommandStats(commandName: string): CommandExecutionStats | undefined {
    return this.stats.get(commandName);
  }

  getAllStats(): Map<string, CommandExecutionStats> {
    return new Map(this.stats);
  }

  getAvailableCommandNames(): string[] {
    return Array.from(this.commands.keys());
  }

  logExecutionSummary(): void {
    const allStats = Array.from(this.stats.entries());
    const totalCommands = allStats.length;
    const totalExecutions = allStats.reduce((sum, [, stats]) => sum + stats.totalExecutions, 0);
    const totalSuccess = allStats.reduce((sum, [, stats]) => sum + stats.successfulExecutions, 0);
    const totalFailed = allStats.reduce((sum, [, stats]) => sum + stats.failedExecutions, 0);
    const successRate = totalExecutions > 0 ? (totalSuccess / totalExecutions * 100).toFixed(2) : '0';

    this.logger.info('Command execution summary', {
      totalCommands,
      totalExecutions,
      totalSuccess,
      totalFailed,
      successRate: `${successRate}%`,
      commands: Object.fromEntries(allStats)
    });
  }
}