import { beforeEach, describe, expect, it, afterEach, vi } from 'vitest';
import { ButtonManager } from '../../src/services/ButtonManager';
import { Logger, LogLevel } from '../../src/utils/logger';
import { registerAllButtons } from '../../src/registry/RegisterButtons';
import { Config } from '../../src/utils/config';

vi.mock('../../src/db/pool', () => ({ getPool: (): unknown => ({ query: vi.fn(() => { throw new Error('Unexpected DB access in registration'); }) }) }));

describe('RegisterButtons', () => {
  let buttonManager: ButtonManager;
  let logger: Logger;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    
    // 必要な環境変数をセット
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';

    // シングルトンをリセット
    (Config as any).instance = undefined;

    logger = new Logger(LogLevel.ERROR); // エラーレベルでログを抑制
    buttonManager = new ButtonManager(logger);
  });

  afterEach(() => {
    process.env = originalEnv;
    (Config as any).instance = undefined;
  });

  describe('registerAllButtons', () => {
    it('registerAllButtons関数が存在する', () => {
      expect(typeof registerAllButtons).toBe('function');
    });

    it('ButtonManagerに全てのボタンハンドラーが登録される', () => {
      const loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
      
      registerAllButtons(buttonManager, logger);
      
      const registeredHandlers = buttonManager.getRegisteredHandlers();
      expect(registeredHandlers.length).toBeGreaterThan(0);
      
      // ログに成功メッセージが出力されることを確認
      expect(loggerInfoSpy).toHaveBeenCalledWith('All button handlers registered successfully');
    });

    it('InitListButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);
      
      const initListHandler = buttonManager.getHandlerByCustomId('init-list-button');
      expect(initListHandler).toBeDefined();
      expect(initListHandler?.constructor.name).toBe('InitListButtonHandler');
    });

    it('EditListButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);
      
      const editListHandler = buttonManager.getHandlerByCustomId('edit-list-button');
      expect(editListHandler).toBeDefined();
      expect(editListHandler?.constructor.name).toBe('EditListButtonHandler');
    });

    it('AddListButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);
      
      const addListHandler = buttonManager.getHandlerByCustomId('add-list-button');
      expect(addListHandler).toBeDefined();
      expect(addListHandler?.constructor.name).toBe('AddListButtonHandler');
    });

    it('RemindTaskUpdateButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);

      const handler = buttonManager.getHandlerByCustomId('remind-task-update');
      expect(handler).toBeDefined();
      expect(handler?.constructor.name).toBe('RemindTaskUpdateButtonHandler');
    });

    it('RemindTaskUpdateCancelButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);

      const handler = buttonManager.getHandlerByCustomId('remind-task-update-cancel');
      expect(handler).toBeDefined();
      expect(handler?.constructor.name).toBe('RemindTaskUpdateCancelButtonHandler');
    });

    it('RemindTaskCompleteButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);

      const handler = buttonManager.getHandlerByCustomId('remind-task-complete');
      expect(handler).toBeDefined();
      expect(handler?.constructor.name).toBe('RemindTaskCompleteButtonHandler');
    });

    it('RemindTaskDeleteButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);

      const handler = buttonManager.getHandlerByCustomId('remind-task-delete');
      expect(handler).toBeDefined();
      expect(handler?.constructor.name).toBe('RemindTaskDeleteButtonHandler');
    });

    it('RemindTaskDetailButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);

      const handler = buttonManager.getHandlerByCustomId('remind-task-detail');
      expect(handler).toBeDefined();
      expect(handler?.constructor.name).toBe('RemindTaskDetailButtonHandler');
    });

    it('RemindTaskAddButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);

      const handler = buttonManager.getHandlerByCustomId('remind-task-add');
      expect(handler).toBeDefined();
      expect(handler?.constructor.name).toBe('RemindTaskAddButtonHandler');
    });

    it('InventoryAddButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);

      const handler = buttonManager.getHandlerByCustomId('inventory_add');
      expect(handler).toBeDefined();
      expect(handler?.constructor.name).toBe('InventoryAddButtonHandler');
    });

    it('InventoryUpdateButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);

      const handler = buttonManager.getHandlerByCustomId('inventory_update');
      expect(handler).toBeDefined();
      expect(handler?.constructor.name).toBe('InventoryUpdateButtonHandler');
    });

    it('InventoryDeleteButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);

      const handler = buttonManager.getHandlerByCustomId('inventory_delete');
      expect(handler).toBeDefined();
      expect(handler?.constructor.name).toBe('InventoryDeleteButtonHandler');
    });

    it('InventorySelectionCancelButtonHandlerが正しく登録される', () => {
      registerAllButtons(buttonManager, logger);

      const handler = buttonManager.getHandlerByCustomId('inventory_selection_cancel');
      expect(handler).toBeDefined();
      expect(handler?.constructor.name).toBe('InventorySelectionCancelButtonHandler');
    });

    it('登録されるハンドラー数が期待する値と一致する', () => {
      registerAllButtons(buttonManager, logger);
      
      const registeredHandlers = buttonManager.getRegisteredHandlers();
      // 現在のボタンハンドラー数: InitListButtonHandler, EditListButtonHandler, AddListButtonHandler,
      // RemindTaskUpdateButtonHandler, RemindTaskUpdateCancelButtonHandler, RemindTaskCompleteButtonHandler,
      // RemindTaskDeleteButtonHandler, RemindTaskDetailButtonHandler, RemindTaskAddButtonHandler,
      // InventoryAddButtonHandler, InventoryUpdateButtonHandler, InventoryDeleteButtonHandler,
      // InventorySelectionCancelButtonHandler
      expect(registeredHandlers).toHaveLength(13);
    });
  });
});
