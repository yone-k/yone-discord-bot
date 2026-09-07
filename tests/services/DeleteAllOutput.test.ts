import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteAllOutput } from '../../src/services/DeleteAllOutput';
import type { Schema } from '../../src/api/contracts';

const job = (count = 0, finished = false): Schema['OutputJob'] => ({
  jobId: 'job', channelId: '100', state: finished ? 'succeeded' : 'running', confirmedDeletedCount: count,
  firstAttemptFinished: finished, lastError: null
});

afterEach(() => vi.useRealTimers());

describe('deleteAllOutput', () => {

  it('fails when no progress was obtained after acceptance', async () => {
    vi.useFakeTimers();
    const api = { deleteAll: vi.fn().mockResolvedValue(job()), job: vi.fn().mockRejectedValue(new Error('offline')) };
    await Promise.all([
      expect(deleteAllOutput('100', api)).rejects.toThrow('offline'),
      vi.advanceTimersByTimeAsync(1000)
    ]);
  });
  it.each(['timeout', 'blocked'])('preserves the legacy zero-count response for confirmed %s progress', async reason => {
    vi.useFakeTimers();
    const api = { deleteAll: vi.fn().mockResolvedValue(reason === 'blocked' ? { ...job(0, true), state: 'blocked' } : job()),
      job: vi.fn().mockResolvedValue(job()) };
    const result = deleteAllOutput('100', api);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe('✅ 削除対象のメッセージはありませんでした。');
  });
  it('retains a zero count obtained by a successful progress read before a later failure', async () => {
    vi.useFakeTimers();
    const api = { deleteAll: vi.fn().mockResolvedValue(job()), job: vi.fn().mockResolvedValueOnce(job()).mockRejectedValue(new Error('offline')) };
    const result = deleteAllOutput('100', api);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe('✅ 削除対象のメッセージはありませんでした。');
  });
  it('polls after one second and reports the confirmed count when the first attempt ends', async () => {
    vi.useFakeTimers();
    const api = { deleteAll: vi.fn().mockResolvedValue(job()), job: vi.fn().mockResolvedValue(job(4, true)) };
    const result = deleteAllOutput('100', api);
    await vi.advanceTimersByTimeAsync(999);
    expect(api.job).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('✅ 4件のメッセージを削除しました。');
    expect(api.deleteAll).toHaveBeenCalledExactlyOnceWith('100');
    expect(api.job).toHaveBeenCalledExactlyOnceWith('job');
  });

  it('returns zero only when the API has supplied a confirmed zero', async () => {
    const api = { deleteAll: vi.fn().mockResolvedValue(job(0, true)), job: vi.fn() };
    expect(await deleteAllOutput('100', api)).toBe('✅ 削除対象のメッセージはありませんでした。');
    expect(api.job).not.toHaveBeenCalled();
  });

  it('returns the last confirmed count after sixty seconds without waiting for eventual completion', async () => {
    vi.useFakeTimers();
    const api = { deleteAll: vi.fn().mockResolvedValue(job()), job: vi.fn().mockResolvedValue(job(7)) };
    const result = deleteAllOutput('100', api);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe('✅ 7件のメッセージを削除しました。');
    const calls = api.job.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.job).toHaveBeenCalledTimes(calls);
  });

  it('preserves the last known count when progress cannot be read', async () => {
    vi.useFakeTimers();
    const api = { deleteAll: vi.fn().mockResolvedValue(job(3)), job: vi.fn().mockRejectedValue(new Error('offline')) };
    const result = deleteAllOutput('100', api);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe('✅ 3件のメッセージを削除しました。');
  });

  it('fails without inventing a count when acceptance has no response', async () => {
    const api = { deleteAll: vi.fn().mockRejectedValue(new Error('offline')), job: vi.fn() };
    await expect(deleteAllOutput('100', api)).rejects.toThrow('offline');
    expect(api.job).not.toHaveBeenCalled();
  });
});
