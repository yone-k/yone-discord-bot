import { describe, expect, it, vi } from 'vitest';
import { UiOperationEvents } from '../../src/services/UiOperationEvents';
import { CoreClient, withInteractionOutput } from '../../src/api/CoreClient';
import { Logger } from '../../src/utils/logger';

describe('UI operation events', () => {
  const interaction = { id: '123', channelId: '456', user: { id: '789' } };
  it.each([{ ...interaction, id: undefined }, { ...interaction, channelId: null }])('does not send an event with missing identifiers', async incomplete => {
    const outputs = { recordEvent: vi.fn() };
    await new UiOperationEvents(new Logger(), outputs).record(incomplete, 'AddListModalHandler', { success: false });
    expect(outputs.recordEvent).not.toHaveBeenCalled();
  });
  it('logs an event API failure without replacing the user operation result', async () => {
    const logger = new Logger();
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const outputs = { recordEvent: vi.fn().mockRejectedValue(new Error('offline')) };
    await expect(new UiOperationEvents(logger, outputs).record(interaction, 'AddListModalHandler', { success: false })).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledExactlyOnceWith('Failed to record UI operation', { interactionId: '123', operationKind: 'AddListModalHandler' });
  });
  it('records local validation failure with the original actor and interaction', async () => {
    const outputs = { recordEvent: vi.fn().mockResolvedValue({}) };
    const service = new UiOperationEvents(new Logger(), outputs);
    await withInteractionOutput(interaction, 'AddListModalHandler', () => service.record(interaction, 'AddListModalHandler', { success: false, message: '入力が無効です' }));
    expect(outputs.recordEvent).toHaveBeenCalledExactlyOnceWith({ actorId: '789', channelId: '456', interactionId: '123', operationKind: 'AddListModalHandler', success: false, message: '入力が無効です', occurredAt: expect.any(String) });
  });
  it.each([200, 409, 503])('does not duplicate a business outcome or invent a failure after HTTP %s', async status => {
    const outputs = { recordEvent: vi.fn() };
    const client = new CoreClient('http://api', 'test', vi.fn().mockResolvedValue(new Response('{}', { status })));
    const service = new UiOperationEvents(new Logger(), outputs);
    await withInteractionOutput(interaction, 'AddListModalHandler', async () => {
      await client.request('POST', '/v1/lists/456/items', {}).catch(() => undefined);
      await service.record(interaction, 'AddListModalHandler', { success: status === 200, message: '結果' });
    });
    expect(outputs.recordEvent).not.toHaveBeenCalled();
  });
});
