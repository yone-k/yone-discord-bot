import { Logger } from '../utils/logger';
import { SelectMenuManager } from '../services/SelectMenuManager';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataManager } from '../services/MetadataManager';
import { RemindMetadataManager } from '../services/RemindMetadataManager';
import { RemindTaskUpdateSelectMenuHandler } from '../selectmenus/RemindTaskUpdateSelectMenuHandler';

export function registerAllSelectMenus(
  selectMenuManager: SelectMenuManager,
  logger: Logger,
  _operationLogService?: OperationLogService,
  _metadataManager?: MetadataManager
): void {
  const remindMetadataManager = RemindMetadataManager.getInstance();
  const remindOperationLogService = new OperationLogService(logger, remindMetadataManager);

  const remindUpdateSelectMenuHandler = new RemindTaskUpdateSelectMenuHandler(
    logger,
    remindOperationLogService,
    remindMetadataManager
  );
  selectMenuManager.registerHandler(remindUpdateSelectMenuHandler);

  logger.info('All select menu handlers registered successfully');
}
