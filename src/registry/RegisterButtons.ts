import { ButtonManager } from '../services/ButtonManager';
import { InitListButtonHandler } from '../buttons/InitListButtonHandler';
import { EditListButtonHandler } from '../buttons/EditListButtonHandler';
import { Logger } from '../utils/logger';

export function registerAllButtons(buttonManager: ButtonManager, logger: Logger): void {
  // InitListButtonHandlerを明示的に登録
  const initListButtonHandler = new InitListButtonHandler(logger);
  buttonManager.registerHandler(initListButtonHandler);
  
  // EditListButtonHandlerを明示的に登録
  const editListButtonHandler = new EditListButtonHandler(logger);
  buttonManager.registerHandler(editListButtonHandler);
  
  logger.info('All button handlers registered successfully');
}