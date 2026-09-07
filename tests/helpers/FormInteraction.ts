import { vi, type Mock } from 'vitest';

interface FormInteraction {
  id: string; customId: string; channelId: string; message: { id: string };
  user: { id: string; bot: boolean }; values: string[]; client: object;
  replied: boolean; deferred: boolean;
  showModal: Mock; deferUpdate: Mock; reply: Mock; followUp: Mock; editReply: Mock;
}

export function formInteraction(customId: string, selection = 'basic'): FormInteraction {
  const interaction = {
    id: 'interaction-1', customId, channelId: 'channel-1', message: { id: 'msg-1' },
    user: { id: 'user-1', bot: false }, values: [selection], client: {},
    replied: false, deferred: false,
    showModal: vi.fn(async () => { interaction.replied = true; }),
    deferUpdate: vi.fn(async () => { interaction.deferred = true; }),
    reply: vi.fn(async () => { interaction.replied = true; }),
    followUp: vi.fn(), editReply: vi.fn()
  };
  return interaction;
}

/** 実CoreClientのAbortSignalとfake timerの両方に従う通信stub。 */
export function delayedFetch(routes: Record<string, { delay: number; body: unknown; status?: number }>): Mock<typeof fetch> {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const route = routes[new URL(String(input)).pathname];
    if (!route) throw new Error(`Unexpected request: ${String(input)}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        init?.signal?.removeEventListener('abort', abort);
        resolve(Response.json(route.body, { status: route.status ?? 200 }));
      }, route.delay);
      const abort = (): void => { clearTimeout(timer); reject(new Error('Aborted')); };
      init?.signal?.addEventListener('abort', abort, { once: true });
    });
  });
}
