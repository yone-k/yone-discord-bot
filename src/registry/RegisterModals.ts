import { ModalManager } from '../services/ModalManager';
import { EditListModalHandler } from '../modals/EditListModalHandler';
import { AddListModalHandler } from '../modals/AddListModalHandler';
import { ConfirmationModalHandler, ConfirmationCallback } from '../modals/ConfirmationModalHandler';
import { RemindTaskUpdateModalHandler } from '../modals/RemindTaskUpdateModalHandler';
import { RemindTaskUpdateOverrideModalHandler } from '../modals/RemindTaskUpdateOverrideModalHandler';
import { RemindTaskCompleteModalHandler } from '../modals/RemindTaskCompleteModalHandler';
import { RemindTaskDeleteModalHandler } from '../modals/RemindTaskDeleteModalHandler';
import { RemindTaskAddModalHandler } from '../modals/RemindTaskAddModalHandler';
import { RemindTaskInventoryModalHandler } from '../modals/RemindTaskInventoryModalHandler';
import { InventoryAddModalHandler } from '../modals/InventoryAddModalHandler';
import { InventoryUpdateModalHandler } from '../modals/InventoryUpdateModalHandler';
import { InventoryDeleteModalHandler } from '../modals/InventoryDeleteModalHandler';
import { deleteAllOutput } from '../services/DeleteAllOutput';
import { Logger } from '../utils/logger';
import { PermissionFlagsBits } from 'discord.js';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { ListChannelStore } from '../services/ListChannelStore';
import { RemindChannelStore } from '../services/RemindChannelStore';

export function registerAllModals(modalManager: ModalManager, logger: Logger): void {
  // 操作ログ関連のサービスを初期化
  const metadataManager = ListChannelStore.getInstance();
  const operationLogService = new UiOperationEvents(logger);
  
  // EditListModalHandlerを明示的に登録（操作ログサービス付き）
  const editListModalHandler = new EditListModalHandler(
    logger,
    undefined, // ListRepository (default)
    metadataManager,
    operationLogService
  );
  modalManager.registerHandler(editListModalHandler);
  
  // AddListModalHandlerを明示的に登録（操作ログサービス付き）
  const addListModalHandler = new AddListModalHandler(
    logger,
    undefined, // ListRepository (default)
    metadataManager,
    operationLogService
  );
  modalManager.registerHandler(addListModalHandler);
  
  const deleteAllMessageCallback: ConfirmationCallback = async (context) => {
    const { interaction } = context;
    
    if (!interaction.guild || !interaction.channel) {
      throw new Error('このコマンドはサーバー内でのみ使用できます。');
    }

    // メンバーの権限をチェック
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      throw new Error('メッセージを削除する権限がありません。');
    }
    return deleteAllOutput(interaction.channel.id);
  };

  // ConfirmationModalHandlerを明示的に登録
  const confirmationModalHandler = new ConfirmationModalHandler(logger, deleteAllMessageCallback, false);
  modalManager.registerHandler(confirmationModalHandler);

  // Remind用のUiOperationEvents
  const remindChannelStore = RemindChannelStore.getInstance();
  const remindUiOperationEvents = new UiOperationEvents(logger);

  const remindUpdateModalHandler = new RemindTaskUpdateModalHandler(logger, remindUiOperationEvents, remindChannelStore);
  modalManager.registerHandler(remindUpdateModalHandler);

  const remindUpdateOverrideModalHandler = new RemindTaskUpdateOverrideModalHandler(
    logger,
    remindUiOperationEvents,
    remindChannelStore
  );
  modalManager.registerHandler(remindUpdateOverrideModalHandler);

  const remindCompleteModalHandler = new RemindTaskCompleteModalHandler(logger, remindUiOperationEvents, remindChannelStore);
  modalManager.registerHandler(remindCompleteModalHandler);

  const remindDeleteModalHandler = new RemindTaskDeleteModalHandler(logger, remindUiOperationEvents, remindChannelStore);
  modalManager.registerHandler(remindDeleteModalHandler);

  const remindAddModalHandler = new RemindTaskAddModalHandler(logger, remindUiOperationEvents, remindChannelStore);
  modalManager.registerHandler(remindAddModalHandler);

  const remindInventoryModalHandler = new RemindTaskInventoryModalHandler(
    logger,
    remindUiOperationEvents,
    remindChannelStore
  );
  modalManager.registerHandler(remindInventoryModalHandler);

  const inventoryAddModalHandler = new InventoryAddModalHandler(logger);
  modalManager.registerHandler(inventoryAddModalHandler);

  const inventoryUpdateModalHandler = new InventoryUpdateModalHandler(logger);
  modalManager.registerHandler(inventoryUpdateModalHandler);

  const inventoryDeleteModalHandler = new InventoryDeleteModalHandler(logger);
  modalManager.registerHandler(inventoryDeleteModalHandler);

  logger.info('All modal handlers registered successfully');
}
