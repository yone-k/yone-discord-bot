import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OutputApi } from '../api/OutputApi';
import { CoreApiError } from '../api/CoreClient';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { Logger } from '../utils/logger';

export class InventorySelectionCancelButtonHandler extends BaseButtonHandler {
  constructor(logger: Logger, private readonly outputs: Pick<OutputApi, 'setCardView'> = new OutputApi()) {
    super('inventory_selection_cancel', logger);
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean { return true; }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    if (!channelId) return { success: false, message: 'チャンネルIDが取得できません' };
    await context.interaction.deferUpdate();
    try {
      await this.outputs.setCardView(channelId, 'inventory', channelId, { mode: 'normal', page: 0 });
      return { success: true, message: '在庫選択をキャンセルしました' };
    } catch (error) {
      const message = error instanceof CoreApiError ? error.message : 'エラーが発生しました。もう一度お試しください。';
      await context.interaction.followUp({ content: message, flags: ['Ephemeral'] as const });
      return { success: false, message };
    }
  }

  protected getOperationInfo(): OperationInfo {
    return { operationType: 'update', actionName: '在庫選択キャンセル' };
  }
}
