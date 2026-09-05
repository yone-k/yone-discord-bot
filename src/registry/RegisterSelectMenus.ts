import { Logger } from '../utils/logger';
import { SelectMenuManager } from '../services/SelectMenuManager';
import { OperationLogService } from '../services/OperationLogService';
import { ListChannelStore } from '../services/ListChannelStore';
import { RemindChannelStore } from '../services/RemindChannelStore';
import { RemindTaskUpdateSelectMenuHandler } from '../selectmenus/RemindTaskUpdateSelectMenuHandler';
import { InventoryDeleteSelectMenuHandler } from '../selectmenus/InventoryDeleteSelectMenuHandler';

export function registerAllSelectMenus(
  selectMenuManager: SelectMenuManager,
  logger: Logger,
  _operationLogService?: OperationLogService,
  _metadataManager?: ListChannelStore
): void {
  const remindChannelStore = RemindChannelStore.getInstance();
  const remindOperationLogService = new OperationLogService(logger, remindChannelStore);

  const remindUpdateSelectMenuHandler = new RemindTaskUpdateSelectMenuHandler(
    logger,
    remindOperationLogService,
    remindChannelStore
  );
  selectMenuManager.registerHandler(remindUpdateSelectMenuHandler);

  const inventoryDeleteSelectMenuHandler = new InventoryDeleteSelectMenuHandler(logger);
  selectMenuManager.registerHandler(inventoryDeleteSelectMenuHandler);

  logger.info('All select menu handlers registered successfully');
}
