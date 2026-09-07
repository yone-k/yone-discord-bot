import { describe, expect, it, vi } from 'vitest';
import { CoreClient, hasOutputWrite, withOutputOperation } from '../../src/api/CoreClient';

describe('output operation write tracking', () => {
  it('keeps concurrent read-only UI actions separate from an uncertain business write', async () => {
    const client = new CoreClient('http://api:8080', 'test', vi.fn().mockRejectedValue(new Error('lost response')));
    const mutate = withOutputOperation({ actorId: '1', operationKind: 'AddListModalHandler' }, async () => {
      expect(hasOutputWrite()).toBe(false);
      await expect(client.request('POST', '/v1/lists/100/items', {})).rejects.toMatchObject({ uncertain: true });
      expect(hasOutputWrite()).toBe(true);
    });
    const read = withOutputOperation({ actorId: '2', operationKind: 'AddListButtonHandler' }, async () => {
      await expect(client.request('GET', '/v1/lists/100')).rejects.toMatchObject({ uncertain: false });
      expect(hasOutputWrite()).toBe(false);
    });
    await Promise.all([mutate, read]);
    expect(hasOutputWrite()).toBe(false);
  });
  it('does not treat posting the UI event itself as a business write', async () => {
    const client = new CoreClient('http://api:8080', 'test', vi.fn().mockResolvedValue(new Response('{}')));
    await withOutputOperation({ actorId: '1', operationKind: 'AddListModalHandler' }, async () => {
      await client.request('POST', '/v1/outputs/operation-log-events', {});
      expect(hasOutputWrite()).toBe(false);
    });
  });
});
