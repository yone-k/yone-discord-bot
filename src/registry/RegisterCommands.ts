import { CommandManager } from '../utils/CommandManager';
import { PingCommand } from '../commands/PingCommand';
import { InitListCommand } from '../commands/InitListCommand';
import { DeleteAllMessageCommand } from '../commands/DeleteAllMessageCommand';
import { AddListCommand } from '../commands/AddListCommand';
import { Logger } from '../utils/logger';

export function registerAllCommands(commandManager: CommandManager, logger: Logger): void {
  // PingCommandを明示的に登録
  const pingCommand = new PingCommand(logger);
  commandManager.register(pingCommand);
  
  // InitListCommandを明示的に登録
  const initListCommand = new InitListCommand(logger);
  commandManager.register(initListCommand);
  
  // DeleteAllMessageCommandを明示的に登録
  const deleteAllMessageCommand = new DeleteAllMessageCommand(logger);
  commandManager.register(deleteAllMessageCommand);
  
  // AddListCommandを明示的に登録
  const addListCommand = new AddListCommand(logger);
  commandManager.register(addListCommand);
  
  logger.info('All commands registered successfully');
}