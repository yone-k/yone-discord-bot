import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { OutputApi } from '../api/OutputApi';
import { CoreApiError } from '../api/CoreClient';

export class RemindTaskUpdateButtonHandler extends BaseButtonHandler {
  private repository: RemindTaskRepository;
  private outputs: Pick<OutputApi, 'setCardView'>;

  constructor(
    logger: Logger,
    operationLogService?: UiOperationEvents,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    outputs?: Pick<OutputApi, 'setCardView'>
  ) {
    super('remind-task-update', logger, operationLogService, metadataManager);
    this.repository = repository || new RemindTaskRepository();
    this.outputs = outputs ?? new OutputApi();
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: 'リマインド更新'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const { interaction } = context;
    const channelId = interaction.channelId;
    const messageId = interaction.message?.id;
    const started = Date.now();
    let stageStarted = started;
    let stage = 'received';
    const log = (level: 'debug' | 'warn' | 'error', errorCode: string | number | null = null): void => {
      const now = Date.now();
      this.logger[level]('繰り返し更新ボタンの処理時間', {
        interactionId: interaction.id ?? null, channelId, messageId: messageId ?? null, selection: null,
        stage, stageElapsedMs: now - stageStarted, totalElapsedMs: now - started,
        replied: Boolean(interaction.replied), deferred: Boolean(interaction.deferred), errorCode
      });
      stageStarted = now;
    };
    const fail = async (message: string): Promise<OperationResult> => {
      const options = { content: message, flags: ['Ephemeral'] as const };
      if (interaction.deferred || interaction.replied) await interaction.followUp(options);
      else await interaction.reply(options);
      return { success: false, message };
    };
    log('debug');
    try {
      if (!channelId || !messageId) {
        log('warn');
        return await fail('チャンネル情報が取得できません。画面を開き直してください。');
      }
      stage = 'initial_response';
      await interaction.deferUpdate();
      log('debug');
      stage = 'task_fetch';
      const task = await this.repository.findTaskByMessageId(channelId, messageId);
      if (!task) {
        log('warn', 'not_found');
        return await fail('タスクが見つかりません。画面を開き直してください。');
      }
      log('debug');
      stage = 'output_reservation';
      await this.outputs.setCardView(channelId, 'task', task.id, { mode: 'update_selection' });
      log('debug');
      return { success: true, message: '更新選択を表示しました' };
    } catch (error) {
      log(error instanceof CoreApiError ? 'warn' : 'error', error instanceof CoreApiError ? error.code : null);
      try {
        return await fail(error instanceof CoreApiError ? error.message : '更新画面を開けませんでした。画面を開き直してください。');
      } catch {
        // 共有メッセージをエラー文で上書きしない。返信自体の失敗もこの経路で扱う。
        log('error');
        return { success: false, message: '更新失敗の通知を送信できませんでした' };
      }
    }
  }
}
