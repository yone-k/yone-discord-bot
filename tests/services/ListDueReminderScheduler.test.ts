import { describe, it, expect, vi } from 'vitest';
import { ListDueReminderScheduler } from '../../src/services/ListDueReminderScheduler';

describe('ListDueReminderScheduler', () => {
  it('sends due reminder and updates last_notified_at', async () => {
    const now = new Date('2026-01-09T00:01:00+09:00');
    const nowIso = now.toISOString();

    const mockMetadataManager = {
      listChannelMetadata: vi.fn().mockResolvedValue([{
        channelId: 'channel-1',
        messageId: 'message-1',
        listTitle: '買い物リスト',
        lastSyncTime: new Date(),
        operationLogThreadId: 'thread-1'
      }])
    };

    const mockGoogleSheetsService = {
      getSheetData: vi.fn().mockResolvedValue([
        ['name', 'category', 'until', 'check', 'last_notified_at'],
        ['牛乳', '食品', '2026-01-09', '0', '']
      ]),
      normalizeData: vi.fn().mockImplementation(data => data),
      updateSheetData: vi.fn().mockResolvedValue({ success: true })
    };

    const mockThread = {
      send: vi.fn().mockResolvedValue(true)
    };

    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(mockThread)
      }
    };

    const scheduler = new ListDueReminderScheduler(
      mockMetadataManager as any,
      mockGoogleSheetsService as any
    );

    await scheduler.runOnce(mockClient as any, now);

    expect(mockClient.channels.fetch).toHaveBeenCalledWith('thread-1');
    expect(mockThread.send).toHaveBeenCalledWith(
      '@everyone 【買い物リスト】牛乳 の期限日(2026/01/09)です。'
    );
    expect(mockGoogleSheetsService.updateSheetData).toHaveBeenCalledWith(
      'channel-1',
      [
        ['name', 'category', 'until', 'check', 'last_notified_at'],
        ['牛乳', '食品', '2026-01-09', 0, nowIso]
      ]
    );
  });
});
