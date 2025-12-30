import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { Logger } from '../utils/logger';
import { OperationResult, OperationInfo } from '../models/types/OperationLog';

export type ConfirmationCallback = (context: ModalHandlerContext) => Promise<string>;

export class ConfirmationModalHandler extends BaseModalHandler {
  private actionCallback: ConfirmationCallback;

  constructor(logger: Logger, actionCallback: ConfirmationCallback, ephemeral: boolean = true) {
    super('confirmation-modal', logger);
    this.deleteOnSuccess = true;
    this.deleteOnFailure = true;
    this.ephemeral = ephemeral;
    this.actionCallback = actionCallback;
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    try {
      if (!this.actionCallback) {
        return {
          success: false,
          message: 'Action callback is not defined',
          error: new Error('Action callback is not defined')
        };
      }

      // コールバック関数を実行し、結果メッセージを取得
      const resultMessage = await this.actionCallback(context);

      // 結果をユーザーに表示
      await context.interaction.editReply({
        content: resultMessage
      });

      return {
        success: true,
        message: resultMessage
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '確認処理中にエラーが発生しました',
        error: error instanceof Error ? error : new Error('Unknown error')
      };
    }
  }

  protected getOperationInfo(_context: ModalHandlerContext): OperationInfo {
    return {
      operationType: 'confirmation',
      actionName: '確認処理'
    };
  }

  protected getSuccessMessage(): string {
    return '処理が完了しました。';
  }
}
