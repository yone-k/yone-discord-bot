import { ModalManager } from '../services/ModalManager';
import { EditListModalHandler } from '../modals/EditListModalHandler';
import { AddListModalHandler } from '../modals/AddListModalHandler';
import { ConfirmationModalHandler, ConfirmationCallback } from '../modals/ConfirmationModalHandler';
import { DeleteAllMessageLogic } from '../services/DeleteAllMessageLogic';
import { Logger } from '../utils/logger';
import { TextChannel } from 'discord.js';

export function registerAllModals(modalManager: ModalManager, logger: Logger): void {
  // EditListModalHandlerを明示的に登録
  const editListModalHandler = new EditListModalHandler(logger);
  modalManager.registerHandler(editListModalHandler);
  
  // AddListModalHandlerを明示的に登録
  const addListModalHandler = new AddListModalHandler(logger);
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
  
  logger.info('All modal handlers registered successfully');
}