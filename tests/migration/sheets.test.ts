import { describe, expect, it, vi } from 'vitest';
import { captureSnapshot } from '../../src/migration/sheets';

describe('readonly Sheets capture', () => {
  it('captures every sheet and every returned column using only get calls', async () => {
    const get = vi.fn().mockResolvedValue({ data: { sheets: [{ properties: { title: 'owner\'s sheet' } }, { properties: { title: 'metadata' } }] } });
    const valuesGet = vi.fn().mockResolvedValue({ data: { values: [['unknown', 'header'], ['12345678901234567890.123', '']] } });
    const snapshot = await captureSnapshot({ spreadsheets: { get, values: { get: valuesGet } } }, 'synthetic', new Date('2026-09-05T00:00:00Z'));
    expect(snapshot.sheets).toHaveLength(2);
    expect(snapshot.sheets[0].rows[1][0]).toBe('12345678901234567890.123');
    expect(valuesGet.mock.calls[0][0].range).toBe('\'owner\'\'s sheet\'');
    expect(valuesGet.mock.calls[0][0].valueRenderOption).toBe('FORMATTED_VALUE');
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('rejects numeric cells rather than silently accepting rounded JSON numbers', async () => {
    const api = { spreadsheets: { get: vi.fn().mockResolvedValue({ data: { sheets: [{ properties: { title: 'metadata' } }] } }), values: { get: vi.fn().mockResolvedValue({ data: { values: [[123]] } }) } } };
    await expect(captureSnapshot(api, 'synthetic')).rejects.toThrow('string');
  });
});
