import { ModalManager } from '../services/ModalManager';
import { EditListModalHandler } from '../modals/EditListModalHandler';
import { AddListModalHandler } from '../modals/AddListModalHandler';
import { ConfirmationModalHandler, ConfirmationCallback } from '../modals/ConfirmationModalHandler';
import { RemindTaskUpdateModalHandler } from '../modals/RemindTaskUpdateModalHandler';
import { RemindTaskCompleteModalHandler } from '../modals/RemindTaskCompleteModalHandler';
import { RemindTaskDeleteModalHandler } from '../modals/RemindTaskDeleteModalHandler';
import { DeleteAllMessageLogic } from '../services/DeleteAllMessageLogic';
import { Logger } from '../utils/logger';
import { TextChannel } from 'discord.js';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataManager } from '../services/MetadataManager';
import { RemindMetadataManager } from '../services/RemindMetadataManager';

export function registerAllModals(modalManager: ModalManager, logger: Logger): void {
  // 操作ログ関連のサービスを初期化
  const metadataManager = MetadataManager.getInstance();
  const operationLogService = new OperationLogService(logger, metadataManager);
  
  // EditListModalHandlerを明示的に登録（操作ログサービス付き）
  const editListModalHandler = new EditListModalHandler(
    logger,
    undefined, // GoogleSheetsService (default)
    undefined, // MessageManager (default)
    metadataManager,
    operationLogService
  );
  modalManager.registerHandler(editListModalHandler);
  
  // AddListModalHandlerを明示的に登録（操作ログサービス付き）
  const addListModalHandler = new AddListModalHandler(
    logger,
    undefined, // GoogleSheetsService (default)
    undefined, // MessageManager (default)
    metadataManager,
    operationLogService
  );
  modalManager.registerHandler(addListModalHandler);
  
  // DeleteAllMessageLogicのコールバック関数を作成
  const deleteAllMessageLogic = new DeleteAllMessageLogic(logger);
  const deleteAllMessageCallback: ConfirmationCallback = async (context) => {
    const { interaction } = context;
    
    if (!interaction.guild || !interaction.channel) {
      throw new Error('このコマンドはサーバー内でのみ使用できます。');
    }

    // メンバーの権限をチェック
    const member = await interaction.guild.members.fetch(interaction.user.id);
    await deleteAllMessageLogic.checkPermissions(member);

    // メッセージを削除
    const result = await deleteAllMessageLogic.deleteAllMessages(interaction.channel as TextChannel, interaction.user.id);
    return `✅ ${result.message}`;
  };

  // ConfirmationModalHandlerを明示的に登録
  const confirmationModalHandler = new ConfirmationModalHandler(logger, deleteAllMessageCallback, false);
  modalManager.registerHandler(confirmationModalHandler);

  // Remind用のOperationLogService
  const remindMetadataManager = RemindMetadataManager.getInstance();
  const remindOperationLogService = new OperationLogService(logger, remindMetadataManager);

  const remindUpdateModalHandler = new RemindTaskUpdateModalHandler(logger, remindOperationLogService, remindMetadataManager);
  modalManager.registerHandler(remindUpdateModalHandler);

  const remindCompleteModalHandler = new RemindTaskCompleteModalHandler(logger, remindOperationLogService, remindMetadataManager);
  modalManager.registerHandler(remindCompleteModalHandler);

  const remindDeleteModalHandler = new RemindTaskDeleteModalHandler(logger, remindOperationLogService, remindMetadataManager);
  modalManager.registerHandler(remindDeleteModalHandler);

  logger.info('All modal handlers registered successfully');
}
