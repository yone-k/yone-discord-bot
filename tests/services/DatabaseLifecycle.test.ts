import { describe, it, expect, vi } from 'vitest';
import { DatabaseLifecycle } from '../../src/services/DatabaseLifecycle';

describe('database readiness lifecycle', () => {
  it('does not connect Discord when the schema or import marker is invalid', async () => {
    const verify = vi.fn().mockRejectedValue(new Error('not imported'));
    const login = vi.fn();
    await expect(new DatabaseLifecycle(verify).connect(login)).rejects.toThrow('not imported');
    expect(login).not.toHaveBeenCalled();
  });
  it('verifies database before Discord connection', async () => {
    const calls: string[] = [];
    await new DatabaseLifecycle(async () => { calls.push('database'); }).connect(async () => { calls.push('discord'); });
    expect(calls).toEqual(['database', 'discord']);
  });
  it('is unready until both Discord and startup display refresh are ready', async () => {
    const lifecycle = new DatabaseLifecycle(async () => {});
    expect((await lifecycle.health(true)).statusCode).toBe(503);
    lifecycle.displaysReady = true;
    expect((await lifecycle.health(false)).statusCode).toBe(503);
    expect((await lifecycle.health(true)).statusCode).toBe(200);
  });
  it('loses readiness when the database becomes unavailable', async () => {
    const verify = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('unreachable secret'));
    const lifecycle = new DatabaseLifecycle(verify);
    lifecycle.displaysReady = true;
    expect((await lifecycle.health(true)).statusCode).toBe(200);
    const health = await lifecycle.health(true);
    expect(health).toEqual({ statusCode: 503, database: { ready: false, schema: 'unavailable' }, ready: false });
  });
});
