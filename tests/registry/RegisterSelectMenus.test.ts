import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, LogLevel } from '../../src/utils/logger';
import { SelectMenuManager } from '../../src/services/SelectMenuManager';
import { registerAllSelectMenus } from '../../src/registry/RegisterSelectMenus';
import { Config } from '../../src/utils/config';

describe('RegisterSelectMenus', () => {
  let selectMenuManager: SelectMenuManager;
  let logger: Logger;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';

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

  it('InventoryUpdateSelectMenuHandlerは登録されない', () => {
    registerAllSelectMenus(selectMenuManager, logger);

    const handler = selectMenuManager.getHandlerByCustomId('inventory_update_select');
    expect(handler).toBeUndefined();
  });

  it('InventoryDeleteSelectMenuHandlerが正しく登録される', () => {
    registerAllSelectMenus(selectMenuManager, logger);

    const handler = selectMenuManager.getHandlerByCustomId('inventory_delete_select');
    expect(handler).toBeDefined();
    expect(handler?.constructor.name).toBe('InventoryDeleteSelectMenuHandler');
  });

  it('登録されるハンドラー数が期待する値と一致する', () => {
    registerAllSelectMenus(selectMenuManager, logger);

    const registeredHandlers = selectMenuManager.getRegisteredHandlers();
    expect(registeredHandlers).toHaveLength(2);
  });
});
vi.mock('../../src/db/pool', () => ({ getPool: (): unknown => ({ query: vi.fn(() => { throw new Error('Unexpected DB access in registration'); }) }) }));
