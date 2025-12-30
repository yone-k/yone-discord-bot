import { ButtonManager } from '../services/ButtonManager';
import { InitListButtonHandler } from '../buttons/InitListButtonHandler';
import { EditListButtonHandler } from '../buttons/EditListButtonHandler';
import { AddListButtonHandler } from '../buttons/AddListButtonHandler';
import { RemindTaskUpdateButtonHandler } from '../buttons/RemindTaskUpdateButtonHandler';
import { RemindTaskCompleteButtonHandler } from '../buttons/RemindTaskCompleteButtonHandler';
import { RemindTaskDeleteButtonHandler } from '../buttons/RemindTaskDeleteButtonHandler';
import { RemindTaskDetailButtonHandler } from '../buttons/RemindTaskDetailButtonHandler';
import { Logger } from '../utils/logger';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataManager } from '../services/MetadataManager';
import { RemindMetadataManager } from '../services/RemindMetadataManager';

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

  // Remind用のOperationLogServiceとMetadataManager
  const remindMetadataManager = RemindMetadataManager.getInstance();
  const remindOperationLogService = new OperationLogService(logger, remindMetadataManager);

  const remindUpdateButtonHandler = new RemindTaskUpdateButtonHandler(logger, remindOperationLogService, remindMetadataManager);
  buttonManager.registerHandler(remindUpdateButtonHandler);

  const remindCompleteButtonHandler = new RemindTaskCompleteButtonHandler(logger, remindOperationLogService, remindMetadataManager);
  buttonManager.registerHandler(remindCompleteButtonHandler);

  const remindDeleteButtonHandler = new RemindTaskDeleteButtonHandler(logger, remindOperationLogService, remindMetadataManager);
  buttonManager.registerHandler(remindDeleteButtonHandler);

  const remindDetailButtonHandler = new RemindTaskDetailButtonHandler(logger, remindOperationLogService, remindMetadataManager);
  buttonManager.registerHandler(remindDetailButtonHandler);
  
  logger.info('All button handlers registered successfully');
}
