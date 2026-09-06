import { describe, expect, it, vi } from 'vitest';
import { CoreClient } from '../../src/api/CoreClient';
import { ApiInventoryRepository, ApiRemindTaskRepository, ApiListRepository } from '../../src/api/Repositories';

describe('generated API adapters', () => {
  it.each([['.', '~Lg'], ['..', '~Li4'], ['a/b', '~YS9i'], ['%2E', '~JTJF'], ['~Lg', '~fkxn'], ['ordinary', 'ordinary']])('keeps opaque ID %s in one URL segment', async (id, path) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id })));
    const repository = new ApiInventoryRepository(new CoreClient('http://api:8080', 'synthetic', fetcher));
    expect(await repository.findById('901', id)).toEqual({ id });
    expect(String(fetcher.mock.calls[0][0])).toBe(`http://api:8080/v1/inventories/901/items/${path}`);
  });
  it('keeps arbitrary legacy IDs channel scoped and sends no client generated ID on create', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    const repository = new ApiInventoryRepository(new CoreClient('http://api:8080', 'synthetic', fetcher));
    await repository.append('channel/a', { id: 'discard', name: 'milk', stock: '0.00001', category: null });
    expect(String(fetcher.mock.calls[0][0])).toBe('http://api:8080/v1/inventories/~Y2hhbm5lbC9h/items');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ name: 'milk', stock: '0.00001', category: null });
  });
  it('sends only expected revision and name based overrides for task completion', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ startAt: '2026-01-01T00:00:00.000Z', nextDueAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastDoneAt: null, lastRemindDueAt: null, lastOverdueNotifiedAt: null })));
    const repository = new ApiRemindTaskRepository(new CoreClient('http://api:8080', 'synthetic', fetcher));
    await repository.complete('channel', 'legacy:task', '9007199254740993', [{ name: 'milk', consume: null }]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ expectedRevision: '9007199254740993', consumeOverrides: [{ name: 'milk', consume: null }] });
  });
  it('hydrates nullable timestamps without changing date only deadlines', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'item', until: '2026-09-06', lastNotifiedAt: null }])));
    const items = await new ApiListRepository(new CoreClient('http://api:8080', 'synthetic', fetcher)).fetchAll('channel');
    expect(items[0].until).toBe('2026-09-06');
    expect(items[0].lastNotifiedAt).toBeNull();
  });
});
