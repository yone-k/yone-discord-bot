import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreClient, CoreApiError, withInteractionDeadline, coreClient, withOutputOperation } from '../../src/api/CoreClient';

describe('Core HTTP boundary', () => {
  it('isolates output actors across concurrent operations and leaves background calls unassigned', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('{}'));
    const client = new CoreClient('http://api:8080', 'synthetic', fetcher);
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const first = withOutputOperation({ actorId: '100', operationKind: 'AddListModalHandler', interactionId: '1000' }, async () => {
      await ready;
      await client.request('POST', '/v1/first');
    });
    await withOutputOperation({ actorId: '200', operationKind: 'reaction' }, () => client.request('POST', '/v1/second'));
    release();
    await first;
    await client.request('POST', '/v1/background');
    const headers = fetcher.mock.calls.map(call => call[1].headers);
    expect(headers[0]['X-Actor-Id']).toBe('200');
    expect(headers[0]['X-Interaction-Id']).toBeUndefined();
    expect(headers[1]['X-Actor-Id']).toBe('100');
    expect(headers[1]['X-Operation-Kind']).toBe('AddListModalHandler');
    expect(headers[1]['X-Interaction-Id']).toBe('1000');
    expect(headers[2]['X-Actor-Id']).toBeUndefined();
  });
  it.each([
    ['quantity', '数量は0以上の数値で入力してください。'],
    ['lastDoneAt', '前回完了日時を確認してください。'],
    ['nextDueAt', '次回期限を確認してください。']
  ])('explains the invalid %s field in Japanese', (target, message) => {
    expect(new CoreApiError('invalid_input', 422, false, { code: 'invalid_input', target }).message).toBe(message);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it('uses the same normalized API configuration as Bot startup', async () => {
    vi.stubEnv('CORE_API_URL', ' http://api:8080 ');
    vi.stubEnv('CORE_API_TOKEN', ' synthetic\n');
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await coreClient().request('GET', '/v1/example');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic');
    vi.stubEnv('CORE_API_URL', 'http://secret:password@api:8080');
    expect(() => coreClient()).toThrow('CORE_API_URL');
  });
  it('sends one authenticated request with a deadline and preserves JSON decimal strings', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stock: '12345678901234567890.123456789' })));
    const client = new CoreClient('http://api:8080', 'synthetic', fetcher);
    expect(await client.request('POST', '/v1/example', { stock: '0.0000000001' })).toEqual({ stock: '12345678901234567890.123456789' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer synthetic');
    expect(init.headers['X-Core-Timeout-Ms']).toBe('5000');
    expect(JSON.parse(init.body)).toEqual({ stock: '0.0000000001' });
  });
  it('does not resend writes after connection loss and explains the uncertain result', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('connection lost token=secret'));
    const client = new CoreClient('http://api:8080', 'synthetic', fetcher);
    await expect(client.request('POST', '/v1/example', {})).rejects.toMatchObject({ uncertain: true });
    await expect(client.request('GET', '/v1/example')).rejects.not.toThrow('secret');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not send a request when less than one millisecond remains', async () => {
    const fetcher = vi.fn();
    const client = new CoreClient('http://api:8080', 'synthetic', fetcher);
    await expect(client.request('POST', '/v1/example', {}, 0.5)).rejects.toMatchObject({ code: 'unavailable', uncertain: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('aborts modal and autocomplete preparation at two seconds', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const client = new CoreClient('http://api:8080', 'synthetic', fetcher);
    const assertion = expect(client.request('GET', '/v1/example', undefined, 2000)).rejects.toBeInstanceOf(CoreApiError);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('maps domain errors without exposing server messages', async () => {
    const client = new CoreClient('http://api:8080', 'synthetic', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'conflict', message: 'SQL secret' }), { status: 409 })));
    await expect(client.request('PATCH', '/v1/example', {})).rejects.toMatchObject({ code: 'conflict', status: 409, uncertain: false });
  });
  it.each([[401, 'unauthorized'], [503, 'unavailable'], [500, 'internal']] as const)('classifies an unrecognized %s response without exposing its body', async (status, code) => {
    const client = new CoreClient('http://api:8080', 'synthetic', vi.fn().mockResolvedValue(new Response('{"code":"unknown","message":"private"}', { status })));
    await expect(client.request('GET', '/v1/example')).rejects.toMatchObject({ code, status, uncertain: false });
  });
  it('accepts an empty 204 response and refuses redirects', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new CoreClient('http://api:8080', 'synthetic', fetcher);
    await expect(client.request('DELETE', '/v1/example')).resolves.toBeUndefined();
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  });
  it('does not treat an HTTP 200 response with ready=false as ready', async () => {
    const client = new CoreClient('http://api:8080', 'synthetic', vi.fn().mockResolvedValue(new Response('{"ready":false}')));
    await expect(client.assertReady()).rejects.toMatchObject({ code: 'unavailable', status: 503 });
  });
  it.each(['go-discord-output-v1', 'legacy', undefined])('checks output contract %s before declaring readiness', async contract => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ready: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ contract, enabled: false, workerRunning: false })));
    const client = new CoreClient('http://api:8080', 'synthetic', fetcher);
    if (contract === 'go-discord-output-v1') await expect(client.assertReady()).resolves.toBeUndefined();
    else await expect(client.assertReady()).rejects.toMatchObject({ code: 'unavailable' });
    expect(String(fetcher.mock.calls[1][0])).toBe('http://api:8080/v1/outputs/status');
  });
  it('preserves shortage quantities and referenced task names for Japanese error display', async () => {
    const details = { code: 'referenced', target: 'inventory', references: [{ channelId: 'channel', title: '米の補充' }] };
    const client = new CoreClient('http://api:8080', 'synthetic', vi.fn().mockResolvedValue(new Response(JSON.stringify(details), { status: 409 })));
    try { await client.request('DELETE', '/v1/example'); throw new Error('expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(CoreApiError);
      expect((error as CoreApiError).details).toEqual(details);
      expect((error as Error).message).toContain('channel: 米の補充');
    }
  });
  it('shares the two second preparation budget and returns to five seconds after defer', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(async () => new Response('{}'));
    const client = new CoreClient('http://api:8080', 'synthetic', fetcher);
    const interaction = { deferred: false };
    await withInteractionDeadline(interaction, async () => {
      await vi.advanceTimersByTimeAsync(1200);
      await client.request('GET', '/v1/example');
      expect(fetcher.mock.calls[0][1].headers['X-Core-Timeout-Ms']).toBe('800');
      interaction.deferred = true;
      await client.request('POST', '/v1/example', {});
      expect(fetcher.mock.calls[1][1].headers['X-Core-Timeout-Ms']).toBe('5000');
    });
  });
});
