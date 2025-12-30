import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataProvider } from '../services/MetadataProvider';

export class RemindTaskDetailModalHandler extends BaseModalHandler {
  constructor(
    logger: Logger,
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    super('remind-task-detail-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.silentOnSuccess = true;
  }

  public shouldHandle(context: ModalHandlerContext): boolean {
    return context.interaction.customId.startsWith('remind-task-detail-modal:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'detail',
      actionName: 'リマインド詳細'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ 詳細を確認しました。';
  }

  protected async executeAction(_context: ModalHandlerContext): Promise<OperationResult> {
    return { success: true };
  }
}
