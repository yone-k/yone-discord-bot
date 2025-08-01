import { ButtonManager } from '../services/ButtonManager';
import { InitListButtonHandler } from '../buttons/InitListButtonHandler';
import { EditListButtonHandler } from '../buttons/EditListButtonHandler';
import { AddListButtonHandler } from '../buttons/AddListButtonHandler';
import { Logger } from '../utils/logger';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataManager } from '../services/MetadataManager';

export function registerAllButtons(
  buttonManager: ButtonManager, 
  logger: Logger,
  operationLogService?: OperationLogService,
  metadataManager?: MetadataManager
): void {
  // InitListButtonHandlerを明示的に登録
  const initListButtonHandler = new InitListButtonHandler(logger, operationLogService, metadataManager);
  buttonManager.registerHandler(initListButtonHandler);
  
  // EditListButtonHandlerを明示的に登録
  const editListButtonHandler = new EditListButtonHandler(logger, operationLogService, metadataManager);
  buttonManager.registerHandler(editListButtonHandler);
  
  // AddListButtonHandlerを明示的に登録
  const addListButtonHandler = new AddListButtonHandler(logger, operationLogService, metadataManager);
  buttonManager.registerHandler(addListButtonHandler);
  
  logger.info('All button handlers registered successfully');
}