import { ButtonManager } from '../services/ButtonManager';
import { InitListButtonHandler } from '../buttons/InitListButtonHandler';
import { EditListButtonHandler } from '../buttons/EditListButtonHandler';
import { AddListButtonHandler } from '../buttons/AddListButtonHandler';
import { RemindTaskUpdateButtonHandler } from '../buttons/RemindTaskUpdateButtonHandler';
import { RemindTaskUpdateCancelButtonHandler } from '../buttons/RemindTaskUpdateCancelButtonHandler';
import { RemindTaskCompleteButtonHandler } from '../buttons/RemindTaskCompleteButtonHandler';
import { RemindTaskDeleteButtonHandler } from '../buttons/RemindTaskDeleteButtonHandler';
import { RemindTaskDetailButtonHandler } from '../buttons/RemindTaskDetailButtonHandler';
import { RemindTaskAddButtonHandler } from '../buttons/RemindTaskAddButtonHandler';
import { InventoryAddButtonHandler } from '../buttons/InventoryAddButtonHandler';
import { InventoryUpdateButtonHandler } from '../buttons/InventoryUpdateButtonHandler';
import { InventoryDeleteButtonHandler } from '../buttons/InventoryDeleteButtonHandler';
import { InventorySelectionCancelButtonHandler } from '../buttons/InventorySelectionCancelButtonHandler';
import { Logger } from '../utils/logger';
import { OperationLogService } from '../services/OperationLogService';
import { ListChannelStore } from '../services/ListChannelStore';
import { RemindChannelStore } from '../services/RemindChannelStore';

export function registerAllButtons(
  buttonManager: ButtonManager, 
  logger: Logger,
  operationLogService?: OperationLogService,
  metadataManager?: ListChannelStore
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

  // Remind用のOperationLogServiceとListChannelStore
  const remindChannelStore = RemindChannelStore.getInstance();
  const remindOperationLogService = new OperationLogService(logger, remindChannelStore);

  const remindUpdateButtonHandler = new RemindTaskUpdateButtonHandler(logger, remindOperationLogService, remindChannelStore);
  buttonManager.registerHandler(remindUpdateButtonHandler);

  const remindUpdateCancelButtonHandler = new RemindTaskUpdateCancelButtonHandler(
    logger,
    remindOperationLogService,
    remindChannelStore
  );
  buttonManager.registerHandler(remindUpdateCancelButtonHandler);

  const remindCompleteButtonHandler = new RemindTaskCompleteButtonHandler(logger, remindOperationLogService, remindChannelStore);
  buttonManager.registerHandler(remindCompleteButtonHandler);

  const remindDeleteButtonHandler = new RemindTaskDeleteButtonHandler(logger, remindOperationLogService, remindChannelStore);
  buttonManager.registerHandler(remindDeleteButtonHandler);

  const remindDetailButtonHandler = new RemindTaskDetailButtonHandler(logger, remindOperationLogService, remindChannelStore);
  buttonManager.registerHandler(remindDetailButtonHandler);

  const remindAddButtonHandler = new RemindTaskAddButtonHandler(logger, remindOperationLogService, remindChannelStore);
  buttonManager.registerHandler(remindAddButtonHandler);

  const inventoryAddButtonHandler = new InventoryAddButtonHandler(logger);
  buttonManager.registerHandler(inventoryAddButtonHandler);

  const inventoryUpdateButtonHandler = new InventoryUpdateButtonHandler(logger);
  buttonManager.registerHandler(inventoryUpdateButtonHandler);

  const inventoryDeleteButtonHandler = new InventoryDeleteButtonHandler(logger);
  buttonManager.registerHandler(inventoryDeleteButtonHandler);

  const inventorySelectionCancelButtonHandler = new InventorySelectionCancelButtonHandler(logger);
  buttonManager.registerHandler(inventorySelectionCancelButtonHandler);
  
  logger.info('All button handlers registered successfully');
}
