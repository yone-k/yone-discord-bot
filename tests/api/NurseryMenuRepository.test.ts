import { describe, expect, it, vi } from 'vitest';
import { CoreClient, withInteractionOutput } from '../../src/api/CoreClient';
import { ApiNurseryMenuRepository } from '../../src/api/Repositories';

describe('ApiNurseryMenuRepository', () => {
  it('registers the channel without output actor headers even inside a command', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ channelId: '100' })));
    const repository = new ApiNurseryMenuRepository(new CoreClient('http://api:8080', 'synthetic', fetcher));

    await withInteractionOutput({ user: { id: '999' }, id: '1000' }, 'InitNurseryMenuCommand', () => repository.setChannel('100'));

    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://api:8080/v1/nursery-menu-channel');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ channelId: '100' });
    expect(init.headers['X-Actor-Id']).toBeUndefined();
    expect(init.headers['X-Operation-Kind']).toBeUndefined();
    expect(init.headers['X-Interaction-Id']).toBeUndefined();
  });

  it('reads one day and treats a missing menu as null', async () => {
    const menu = { date: '2026-10-02', lunch: 'ご飯', snack: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(menu)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'not_found' }), { status: 404 }));
    const repository = new ApiNurseryMenuRepository(new CoreClient('http://api:8080', 'synthetic', fetcher));

    expect(await repository.get('2026-10-02')).toEqual(menu);
    expect(await repository.get('2026-10-03')).toBeNull();
    expect(String(fetcher.mock.calls[0][0])).toBe('http://api:8080/v1/nursery-menus/2026-10-02');
  });
});
