import { CommandManager } from '../utils/CommandManager';
import { PingCommand } from '../commands/PingCommand';
import { InitListCommand } from '../commands/InitListCommand';
import { DeleteAllMessageCommand } from '../commands/DeleteAllMessageCommand';
import { AddListCommand } from '../commands/AddListCommand';
import { InitRemindListCommand } from '../commands/InitRemindListCommand';
import { AddRemindListCommand } from '../commands/AddRemindListCommand';
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

  const initRemindListCommand = new InitRemindListCommand(logger);
  commandManager.register(initRemindListCommand);

  const addRemindListCommand = new AddRemindListCommand(logger);
  commandManager.register(addRemindListCommand);
  
  logger.info('All commands registered successfully');
}
