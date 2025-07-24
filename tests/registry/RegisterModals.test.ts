import { beforeEach, describe, expect, it, afterEach, vi } from 'vitest';
import { ModalManager } from '../../src/services/ModalManager';
import { Logger, LogLevel } from '../../src/utils/logger';
import { registerAllModals } from '../../src/registry/RegisterModals';
import { Config } from '../../src/utils/config';

// Google APIs のモック
vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(() => ({}))
    },
    sheets: vi.fn().mockReturnValue({
      spreadsheets: {
        get: vi.fn(),
        batchUpdate: vi.fn(),
        values: {
          get: vi.fn(),
          append: vi.fn()
        }
      }
    })
  }
}));

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getClient: vi.fn().mockResolvedValue({})
  }))
}));

describe('RegisterModals', () => {
  let modalManager: ModalManager;
  let logger: Logger;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    
    // 必要な環境変数をセット
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
    process.env.GOOGLE_PRIVATE_KEY = 'test-private-key';

    // シングルトンをリセット
    (Config as any).instance = undefined;

    logger = new Logger(LogLevel.ERROR); // エラーレベルでログを抑制
    modalManager = new ModalManager(logger);
  });

  afterEach(() => {
    process.env = originalEnv;
    (Config as any).instance = undefined;
  });

  describe('registerAllModals', () => {
    it('registerAllModals関数が存在する', () => {
      expect(typeof registerAllModals).toBe('function');
    });

    it('ModalManagerに全てのモーダルハンドラーが登録される', () => {
      const loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
      
      registerAllModals(modalManager, logger);
      
      const registeredHandlers = modalManager.getRegisteredHandlers();
      expect(registeredHandlers.length).toBeGreaterThan(0);
      
      // ログに成功メッセージが出力されることを確認
      expect(loggerInfoSpy).toHaveBeenCalledWith('All modal handlers registered successfully');
    });

    it('EditListModalHandlerが正しく登録される', () => {
      registerAllModals(modalManager, logger);
      
      const registeredHandlers = modalManager.getRegisteredHandlers();
      const editListHandler = registeredHandlers.find(handler => 
        handler.getCustomId() === 'edit-list-modal'
      );
      expect(editListHandler).toBeDefined();
      expect(editListHandler?.constructor.name).toBe('EditListModalHandler');
    });

    it('AddListModalHandlerが正しく登録される', () => {
      registerAllModals(modalManager, logger);
      
      const registeredHandlers = modalManager.getRegisteredHandlers();
      const addListHandler = registeredHandlers.find(handler => 
        handler.getCustomId() === 'add-list-modal'
      );
      expect(addListHandler).toBeDefined();
      expect(addListHandler?.constructor.name).toBe('AddListModalHandler');
    });

    it('ConfirmationModalHandlerが正しく登録される', () => {
      registerAllModals(modalManager, logger);
      
      const registeredHandlers = modalManager.getRegisteredHandlers();
      const confirmationHandler = registeredHandlers.find(handler => 
        handler.getCustomId() === 'confirmation-modal'
      );
      expect(confirmationHandler).toBeDefined();
      expect(confirmationHandler?.constructor.name).toBe('ConfirmationModalHandler');
    });

    it('登録されるハンドラー数が期待する値と一致する', () => {
      registerAllModals(modalManager, logger);
      
      const registeredHandlers = modalManager.getRegisteredHandlers();
      // 現在のモーダルハンドラー数: EditListModalHandler, AddListModalHandler, ConfirmationModalHandler
      expect(registeredHandlers).toHaveLength(3);
    });
  });
});