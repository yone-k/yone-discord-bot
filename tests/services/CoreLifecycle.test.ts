import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreLifecycle } from '../../src/services/CoreLifecycle';

describe('Core API readiness', () => {
  afterEach(() => vi.useRealTimers());
  it('recovers startup display failures and starts notifications only once', async () => {
    vi.useFakeTimers();
    const lifecycle = new CoreLifecycle(async () => {});
    const render = vi.fn().mockRejectedValueOnce(new Error('Discord unavailable')).mockResolvedValue(undefined);
    const start = vi.fn();
    const report = vi.fn();
    lifecycle.initializeDisplays(render, start, report);
    await vi.advanceTimersByTimeAsync(0);
    expect((await lifecycle.health(true)).ready).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await lifecycle.health(true)).ready).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    lifecycle.initializeDisplays(render, start, report);
    expect(render).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(1);
    lifecycle.stop();
  });
  it('does not overlap display refreshes or start notifications after shutdown', async () => {
    vi.useFakeTimers();
    const lifecycle = new CoreLifecycle(async () => {});
    let release!: () => void;
    const render = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const start = vi.fn();
    lifecycle.initializeDisplays(render, start, vi.fn());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(render).toHaveBeenCalledTimes(1);
    lifecycle.stop();
    release();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(start).not.toHaveBeenCalled();
    expect((await lifecycle.health(true)).ready).toBe(false);
  });
  it('checks API readiness before logging in to Discord', async () => {
    const calls: string[] = [];
    await new CoreLifecycle(async () => { calls.push('api'); }).connect(async () => { calls.push('discord'); });
    expect(calls).toEqual(['api', 'discord']);
  });
  it('does not log in when API rejects schema or import readiness', async () => {
    const login = vi.fn();
    await expect(new CoreLifecycle(async () => { throw new Error('unavailable'); }).connect(login)).rejects.toThrow('unavailable');
    expect(login).not.toHaveBeenCalled();
  });
  it('requires both startup rendering and live Discord readiness', async () => {
    const lifecycle = new CoreLifecycle(async () => {});
    expect((await lifecycle.health(true)).ready).toBe(false);
    lifecycle.displaysReady = true;
    expect((await lifecycle.health(false)).ready).toBe(false);
    expect((await lifecycle.health(true)).ready).toBe(true);
  });
  it('stops reporting ready when the API goes down without exposing failure details', async () => {
    const verify = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('secret'));
    const lifecycle = new CoreLifecycle(verify);
    lifecycle.displaysReady = true;
    expect((await lifecycle.health(true)).statusCode).toBe(200);
    expect(await lifecycle.health(true)).toEqual({ ready: false, statusCode: 503, api: { ready: false } });
  });
});
