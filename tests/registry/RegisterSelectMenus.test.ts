import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, LogLevel } from '../../src/utils/logger';
import { SelectMenuManager } from '../../src/services/SelectMenuManager';
import { registerAllSelectMenus } from '../../src/registry/RegisterSelectMenus';
import { Config } from '../../src/utils/config';

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

describe('RegisterSelectMenus', () => {
  let selectMenuManager: SelectMenuManager;
  let logger: Logger;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
    process.env.GOOGLE_PRIVATE_KEY = 'test-private-key';

    (Config as any).instance = undefined;

    logger = new Logger(LogLevel.ERROR);
    selectMenuManager = new SelectMenuManager(logger);
  });

  afterEach(() => {
    process.env = originalEnv;
    (Config as any).instance = undefined;
  });

  it('registerAllSelectMenus関数が存在する', () => {
    expect(typeof registerAllSelectMenus).toBe('function');
  });

  it('SelectMenuManagerに全てのセレクトメニューハンドラーが登録される', () => {
    const loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

    registerAllSelectMenus(selectMenuManager, logger);

    const registeredHandlers = selectMenuManager.getRegisteredHandlers();
    expect(registeredHandlers.length).toBeGreaterThan(0);
    expect(loggerInfoSpy).toHaveBeenCalledWith('All select menu handlers registered successfully');
  });

  it('RemindTaskUpdateSelectMenuHandlerが正しく登録される', () => {
    registerAllSelectMenus(selectMenuManager, logger);

    const handler = selectMenuManager.getHandlerByCustomId('remind-task-update-select');
    expect(handler).toBeDefined();
    expect(handler?.constructor.name).toBe('RemindTaskUpdateSelectMenuHandler');
  });

  it('登録されるハンドラー数が期待する値と一致する', () => {
    registerAllSelectMenus(selectMenuManager, logger);

    const registeredHandlers = selectMenuManager.getRegisteredHandlers();
    expect(registeredHandlers).toHaveLength(1);
  });
});
