import { describe, expect, it, vi } from 'vitest';
import { CoreLifecycle } from '../../src/services/CoreLifecycle';

describe('Core API readiness', () => {
  it('checks API readiness before logging in to Discord', async () => {
    const calls: string[] = [];
    await new CoreLifecycle(async () => { calls.push('api'); }).connect(async () => { calls.push('discord'); });
    expect(calls).toEqual(['api', 'discord']);
  });
  it('does not log in when the API readiness verifier fails', async () => {
    const login = vi.fn();
    await expect(new CoreLifecycle(async () => { throw new Error('unavailable'); }).connect(login)).rejects.toThrow('unavailable');
    expect(login).not.toHaveBeenCalled();
  });
  it('reports readiness from the API and Gateway without waiting for output delivery', async () => {
    const lifecycle = new CoreLifecycle(async () => {});
    expect((await lifecycle.health(false)).ready).toBe(false);
    expect((await lifecycle.health(true)).ready).toBe(true);
    lifecycle.stop();
    expect((await lifecycle.health(true)).ready).toBe(false);
  });
  it('stops reporting ready when the API goes down without exposing failure details', async () => {
    const verify = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('secret'));
    const lifecycle = new CoreLifecycle(verify);
    expect((await lifecycle.health(true)).statusCode).toBe(200);
    expect(await lifecycle.health(true)).toEqual({ ready: false, statusCode: 503, api: { ready: false } });
  });
});
