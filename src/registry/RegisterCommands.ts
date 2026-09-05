import { CommandManager } from '../utils/CommandManager';
import { PingCommand } from '../commands/PingCommand';
import { InitListCommand } from '../commands/InitListCommand';
import { DeleteAllMessageCommand } from '../commands/DeleteAllMessageCommand';
import { AddListCommand } from '../commands/AddListCommand';
import { InitRemindListCommand } from '../commands/InitRemindListCommand';
import { InitInventoryCommand } from '../commands/InitInventoryCommand';
import { AddRemindListCommand } from '../commands/AddRemindListCommand';
import { AddInventoryCommand } from '../commands/AddInventoryCommand';
import { DeleteInventoryCommand } from '../commands/DeleteInventoryCommand';
import { LinkInventoryCommand } from '../commands/LinkInventoryCommand';
import { UnlinkInventoryCommand } from '../commands/UnlinkInventoryCommand';
import { UpdateInventoryCommand } from '../commands/UpdateInventoryCommand';
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

  const initInventoryCommand = new InitInventoryCommand(logger);
  commandManager.register(initInventoryCommand);

  const addRemindListCommand = new AddRemindListCommand(logger);
  commandManager.register(addRemindListCommand);

  const addInventoryCommand = new AddInventoryCommand(logger);
  commandManager.register(addInventoryCommand);

  const deleteInventoryCommand = new DeleteInventoryCommand(logger);
  commandManager.register(deleteInventoryCommand);

  const linkInventoryCommand = new LinkInventoryCommand(logger);
  commandManager.register(linkInventoryCommand);

  const unlinkInventoryCommand = new UnlinkInventoryCommand(logger);
  commandManager.register(unlinkInventoryCommand);

  const updateInventoryCommand = new UpdateInventoryCommand(logger);
  commandManager.register(updateInventoryCommand);
  
  logger.info('All commands registered successfully');
}
