import { CommandManager } from '../utils/CommandManager';
import { PingCommand } from '../commands/PingCommand';
import { Logger } from '../utils/logger';

export function registerAllCommands(commandManager: CommandManager, logger: Logger): void {
  // PingCommandを明示的に登録
  const pingCommand = new PingCommand(logger);
  commandManager.register(pingCommand);
  
  logger.info('All commands registered successfully');
}