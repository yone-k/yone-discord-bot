import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemindSheetManager } from '../../src/services/RemindSheetManager';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import { getRemindSheetHeaders } from '../../src/utils/RemindSheetMapper';

vi.mock('../../src/services/GoogleSheetsService');

describe('RemindSheetManager', () => {
  let mockGoogleSheetsService: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let remindSheetManager: RemindSheetManager;

  beforeEach(() => {
    mockGoogleSheetsService = {
      createSheetByName: vi.fn(),
      getSheetDataByName: vi.fn(),
      appendSheetData: vi.fn(),
      validateData: vi.fn(),
      normalizeData: vi.fn()
    };

    vi.mocked(GoogleSheetsService.getInstance).mockReturnValue(mockGoogleSheetsService);

    remindSheetManager = new RemindSheetManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses remind sheet naming convention', () => {
    const sheetName = remindSheetManager.getSheetNameForChannel('123');
    expect(sheetName).toBe('remind_list_123');
  });

  it('creates remind sheet with headers', async () => {
    const channelId = '123';
    mockGoogleSheetsService.createSheetByName.mockResolvedValue({ success: true, sheetId: 1 });
    mockGoogleSheetsService.appendSheetData.mockResolvedValue({ success: true });

    const result = await remindSheetManager.createChannelSheetWithHeaders(channelId);

    expect(mockGoogleSheetsService.createSheetByName).toHaveBeenCalledWith('remind_list_123');
    expect(mockGoogleSheetsService.appendSheetData).toHaveBeenCalledWith(
      'remind_list_123',
      [getRemindSheetHeaders()]
    );
    expect(result.success).toBe(true);
  });

  it('returns existing data when sheet exists', async () => {
    mockGoogleSheetsService.getSheetDataByName.mockResolvedValue([['id']]);

    const result = await remindSheetManager.getOrCreateChannelSheet('123');

    expect(result.existed).toBe(true);
    expect(result.data).toEqual([['id']]);
  });
});
