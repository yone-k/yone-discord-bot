import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { Logger } from '../utils/logger';

export type ConfirmationCallback = (context: ModalHandlerContext) => Promise<string>;

export class ConfirmationModalHandler extends BaseModalHandler {
  private actionCallback: ConfirmationCallback;

  constructor(logger: Logger, actionCallback: ConfirmationCallback, ephemeral: boolean = true) {
    super('confirmation-modal', logger);
    this.deleteOnSuccess = true;
    this.ephemeral = ephemeral;
    this.actionCallback = actionCallback;
  }

  protected async executeAction(context: ModalHandlerContext): Promise<void> {
    if (!this.actionCallback) {
      throw new Error('Action callback is not defined');
    }

    // コールバック関数を実行し、結果メッセージを取得
    const resultMessage = await this.actionCallback(context);

    // 結果をユーザーに表示
    await context.interaction.editReply({
      content: resultMessage
    });
  }

  protected getSuccessMessage(): string {
    return '処理が完了しました。';
  }
}