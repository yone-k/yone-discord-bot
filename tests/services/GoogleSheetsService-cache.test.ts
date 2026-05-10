import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
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
          append: vi.fn(),
          update: vi.fn(),
          clear: vi.fn()
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

const resetGoogleSheetsServiceSingleton = (): void => {
  const instance = (GoogleSheetsService as any).instance;
  instance?.sheetCache?.clear?.();
  (GoogleSheetsService as any).instance = undefined;
};

describe('GoogleSheetsService sheet data cache', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockSheets: any;
  let mockGoogleAuth: any;

  beforeEach(async () => {
    originalEnv = { ...process.env };

    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@service.account';
    process.env.GOOGLE_PRIVATE_KEY = 'test-private-key';

    (Config as any).instance = undefined;
    resetGoogleSheetsServiceSingleton();

    const { google } = await import('googleapis');
    const { GoogleAuth } = await import('google-auth-library');

    mockGoogleAuth = GoogleAuth as any;
    mockSheets = (google.sheets as any)().spreadsheets;

    mockGoogleAuth.mockImplementation(() => ({
      getClient: vi.fn().mockResolvedValue({})
    }));

    mockSheets.values.get.mockImplementation(({ range }: { range: string }) => Promise.resolve({
      data: {
        values: [[`${range}:fetched:${mockSheets.values.get.mock.calls.length}`]]
      }
    }));
    mockSheets.values.update.mockResolvedValue({ data: {} });
    mockSheets.values.append.mockResolvedValue({ data: {} });
    mockSheets.values.clear.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
    (Config as any).instance = undefined;
    resetGoogleSheetsServiceSingleton();
    vi.clearAllMocks();
  });

  it('同じ sheetName で getSheetDataByName を 2 回呼ぶと、内部の sheets.values.get は 1 回しか呼ばれない（キャッシュヒット）', async () => {
    const service = GoogleSheetsService.getInstance();

    const first = await service.getSheetDataByName('inventory_cache_hit');
    const second = await service.getSheetDataByName('inventory_cache_hit');

    expect(second).toEqual(first);
    expect(mockSheets.values.get).toHaveBeenCalledTimes(1);
  });

  it('getSheetDataByName({ skipCache: true }) はキャッシュ存在時でも API を呼ぶ', async () => {
    const service = GoogleSheetsService.getInstance() as unknown as {
      getSheetDataByName(sheetName: string, options?: { skipCache?: boolean }): Promise<string[][]>;
    };

    await service.getSheetDataByName('inventory_skip_cache');
    await service.getSheetDataByName('inventory_skip_cache', { skipCache: true });

    expect(mockSheets.values.get).toHaveBeenCalledTimes(2);
  });

  it('getSheetDataByName({ skipCache: true }) の結果は cache に保存されず、後続の通常 read で再フェッチする', async () => {
    const service = GoogleSheetsService.getInstance() as unknown as {
      sheetCache: Map<string, unknown>;
      getSheetDataByName(sheetName: string, options?: { skipCache?: boolean }): Promise<string[][]>;
    };
    mockSheets.values.get.mockImplementation(() => Promise.resolve({
      data: {
        values: mockSheets.values.get.mock.calls.length === 1
          ? [['skip cache api value']]
          : [['normal read api value']]
      }
    }));

    expect(service.sheetCache.size).toBe(0);

    const skipCacheRead = await service.getSheetDataByName('inventory_skip_cache_no_store', { skipCache: true });
    const normalRead = await service.getSheetDataByName('inventory_skip_cache_no_store');

    expect(skipCacheRead).toEqual([['skip cache api value']]);
    expect(normalRead).toEqual([['normal read api value']]);
    expect(mockSheets.values.get).toHaveBeenCalledTimes(2);
  });

  it('getSheetDataByName({ skipCache: true }) の結果は既存 cache を上書きしない', async () => {
    const service = GoogleSheetsService.getInstance() as unknown as {
      getSheetDataByName(sheetName: string, options?: { skipCache?: boolean }): Promise<string[][]>;
      updateSheetData(sheetName: string, data: unknown[][]): Promise<{ success: boolean }>;
    };
    const oldData = [['id', 'name'], ['1', 'old']];
    const newData = [['id', 'name'], ['1', 'new']];
    mockSheets.values.get.mockImplementation(() => Promise.resolve({ data: { values: newData } }));

    await service.updateSheetData('inventory_skip_cache_preserve_write_through', oldData);
    const skipCacheRead = await service.getSheetDataByName('inventory_skip_cache_preserve_write_through', { skipCache: true });
    const cached = await service.getSheetDataByName('inventory_skip_cache_preserve_write_through');

    expect(skipCacheRead).toEqual(newData);
    expect(cached).toEqual(oldData);
    expect(mockSheets.values.get).toHaveBeenCalledTimes(1);
  });

  it('updateSheetData(sheetName, data) 後の getSheetDataByName(sheetName) は書き込み内容をキャッシュから返す', async () => {
    const service = GoogleSheetsService.getInstance();

    await service.updateSheetData('inventory_x', [['id', 'name'], ['1', 'foo']]);
    const cached = await service.getSheetDataByName('inventory_x');

    expect(cached).toEqual([['id', 'name'], ['1', 'foo']]);
    expect(mockSheets.values.get).not.toHaveBeenCalled();
  });

  it('updateSheetData(sheetName, data) の write-through cache は通常 TTL（5秒）経過後も 60秒までは保持される', async () => {
    vi.useFakeTimers();
    const service = GoogleSheetsService.getInstance();
    const writtenData = [['id', 'name'], ['1', 'foo']];
    const apiData = [['id', 'name'], ['1', 'api']];
    mockSheets.values.get.mockResolvedValue({ data: { values: apiData } });

    await service.updateSheetData('inventory_write_through_long_ttl', writtenData);

    vi.advanceTimersByTime(5500);
    const cachedAfterNormalTtl = await service.getSheetDataByName('inventory_write_through_long_ttl');

    expect(cachedAfterNormalTtl).toEqual(writtenData);
    expect(mockSheets.values.get).not.toHaveBeenCalled();

    vi.advanceTimersByTime(54501);
    const refetchedAfterWriteThroughTtl = await service.getSheetDataByName('inventory_write_through_long_ttl');

    expect(refetchedAfterWriteThroughTtl).toEqual(apiData);
    expect(mockSheets.values.get).toHaveBeenCalledTimes(1);
  });

  it('updateSheetData(sheetName, data) の data が混合型でもキャッシュは string[][] に正規化される', async () => {
    const service = GoogleSheetsService.getInstance();

    await service.updateSheetData('inventory_x', [['id', 'stock'], ['1', 5]]);
    const cached = await service.getSheetDataByName('inventory_x');

    expect(cached).toEqual([['id', 'stock'], ['1', '5']]);
    expect(mockSheets.values.get).not.toHaveBeenCalled();
  });

  it('updateSheetData(sheetName, data, range) は対象 sheetName のキャッシュを invalidate して再フェッチする', async () => {
    const service = GoogleSheetsService.getInstance();

    await service.getSheetDataByName('inventory_range_x');
    await service.getSheetDataByName('inventory_range_x');
    expect(mockSheets.values.get).toHaveBeenCalledTimes(1);

    await service.updateSheetData('inventory_range_x', [['id', 'name'], ['1', 'foo']], 'inventory_range_x!A1:B2');
    await service.getSheetDataByName('inventory_range_x');

    expect(mockSheets.values.get).toHaveBeenCalledTimes(2);
  });

  it('appendSheetData(sheetName, ...) でも対象 sheetName のキャッシュが invalidate される', async () => {
    const service = GoogleSheetsService.getInstance();

    await service.getSheetDataByName('inventory_append_target');
    await service.getSheetDataByName('inventory_append_target');
    expect(mockSheets.values.get).toHaveBeenCalledTimes(1);

    await service.appendSheetData('inventory_append_target', [['appended']]);
    await service.getSheetDataByName('inventory_append_target');

    expect(mockSheets.values.get).toHaveBeenCalledTimes(2);
  });

  it('TTL（5秒）経過後は getSheetDataByName が再フェッチする', async () => {
    vi.useFakeTimers();
    const service = GoogleSheetsService.getInstance();

    await service.getSheetDataByName('inventory_ttl_target');
    vi.advanceTimersByTime(4999);
    await service.getSheetDataByName('inventory_ttl_target');
    expect(mockSheets.values.get).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await service.getSheetDataByName('inventory_ttl_target');
    expect(mockSheets.values.get).toHaveBeenCalledTimes(2);
  });

  it('同じ sheetName の getSheetDataByName を 3 並列で呼ぶと、in-flight dedupe により API 呼び出しは 1 回にまとまる', async () => {
    const service = GoogleSheetsService.getInstance();
    const apiData = [['id', 'name'], ['1', 'deduped']];
    mockSheets.values.get.mockResolvedValue({ data: { values: apiData } });

    const results = await Promise.all([
      service.getSheetDataByName('inventory_in_flight_dedupe'),
      service.getSheetDataByName('inventory_in_flight_dedupe'),
      service.getSheetDataByName('inventory_in_flight_dedupe')
    ]);

    expect(mockSheets.values.get).toHaveBeenCalledTimes(1);
    expect(results).toEqual([apiData, apiData, apiData]);
  });

  it('getSheetDataByName({ skipCache: true }) の 3 並列 read は in-flight dedupe 対象外で API を 3 回呼ぶ', async () => {
    const service = GoogleSheetsService.getInstance() as unknown as {
      getSheetDataByName(sheetName: string, options?: { skipCache?: boolean }): Promise<string[][]>;
    };
    const apiData = [['id', 'name'], ['1', 'skip cache']];
    mockSheets.values.get.mockResolvedValue({ data: { values: apiData } });

    const results = await Promise.all([
      service.getSheetDataByName('inventory_skip_cache_no_dedupe', { skipCache: true }),
      service.getSheetDataByName('inventory_skip_cache_no_dedupe', { skipCache: true }),
      service.getSheetDataByName('inventory_skip_cache_no_dedupe', { skipCache: true })
    ]);

    expect(mockSheets.values.get).toHaveBeenCalledTimes(3);
    expect(results).toEqual([apiData, apiData, apiData]);
  });

  it('in-flight dedupe で取得した結果は cache に保存され、直後の通常 read は API を呼ばない', async () => {
    const service = GoogleSheetsService.getInstance();
    const apiData = [['id', 'name'], ['1', 'cached after dedupe']];
    mockSheets.values.get.mockResolvedValue({ data: { values: apiData } });

    await Promise.all([
      service.getSheetDataByName('inventory_dedupe_cache_store'),
      service.getSheetDataByName('inventory_dedupe_cache_store'),
      service.getSheetDataByName('inventory_dedupe_cache_store')
    ]);

    mockSheets.values.get.mockClear();
    const cached = await service.getSheetDataByName('inventory_dedupe_cache_store');

    expect(cached).toEqual(apiData);
    expect(mockSheets.values.get).not.toHaveBeenCalled();
  });

  it('異なる sheetName のキャッシュは独立している（A の invalidate で B のキャッシュは保持）', async () => {
    const service = GoogleSheetsService.getInstance();

    await service.getSheetDataByName('inventory_cache_a');
    await service.getSheetDataByName('inventory_cache_b');
    await service.getSheetDataByName('inventory_cache_a');
    expect(mockSheets.values.get).toHaveBeenCalledTimes(2);

    const updatedA = await service.updateSheetData('inventory_cache_a', [['updated a']]);
    const cachedA = await service.getSheetDataByName('inventory_cache_a');
    const cachedB = await service.getSheetDataByName('inventory_cache_b');

    expect(updatedA.success).toBe(true);
    expect(cachedA).toEqual([['updated a']]);
    expect(cachedB).toEqual([['inventory_cache_b!A:Z:fetched:2']]);
    expect(mockSheets.values.get).toHaveBeenCalledTimes(2);
  });
});
