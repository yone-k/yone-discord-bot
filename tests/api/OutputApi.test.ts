import { expect, it, vi } from 'vitest';
import { CoreClient, withOutputOperation } from '../../src/api/CoreClient';
import { OutputApi } from '../../src/api/OutputApi';

it('reserves a card view with opaque IDs and the current interaction actor', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"version":"2"}'));
  const outputs = new OutputApi(new CoreClient('http://api:8080', 'test-token', fetcher));
  await withOutputOperation({ actorId: '999', operationKind: 'RemindTaskUpdateCancelButtonHandler', interactionId: '888' }, () => outputs.setCardView('100', 'task', 'legacy/a%2F', { mode: 'normal' }));
  const [url, request] = fetcher.mock.calls[0];
  expect(url.pathname).toBe(`/v1/outputs/card-view/100/task/~${Buffer.from('legacy/a%2F').toString('base64url')}`);
  expect(request.headers['X-Actor-Id']).toBe('999');
  expect(request.headers['X-Interaction-Id']).toBe('888');
  expect(JSON.parse(request.body)).toEqual({ mode: 'normal' });
});
