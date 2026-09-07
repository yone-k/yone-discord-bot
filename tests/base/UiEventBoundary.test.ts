import { describe, expect, it, vi } from 'vitest';
import { BaseModalHandler } from '../../src/base/BaseModalHandler';
import { UiOperationEvents } from '../../src/services/UiOperationEvents';
import { CoreClient } from '../../src/api/CoreClient';
import type { OperationInfo, OperationResult } from '../../src/models/types/OperationLog';
import { Logger } from '../../src/utils/logger';

describe('modal outcome boundary', () => {
  it.each(['validation', 'saved', 'uncertain'])('records only the local outcome for %s', async mode => {
    const recordEvent = vi.fn().mockResolvedValue({});
    const fetcher = mode === 'uncertain' ? vi.fn().mockRejectedValue(new Error('response lost')) : vi.fn().mockResolvedValue(new Response('{}'));
    const client = new CoreClient('http://api', 'test', fetcher);
    class AddListModalHandler extends BaseModalHandler {
      constructor() { super('modal', new Logger(), new UiOperationEvents(new Logger(), { recordEvent })); }
      protected async executeAction(): Promise<OperationResult> {
        if (mode === 'validation') return { success: false, message: '入力が無効です' };
        try { await client.request('POST', '/v1/lists/456/items', {}); return { success: true }; }
        catch (error) { return { success: false, message: (error as Error).message }; }
      }
      protected getOperationInfo(): OperationInfo { return { operationType: 'add', actionName: '追加' }; }
      protected getSuccessMessage(): string { return '保存しました'; }
    }
    const interaction = { id: '123', customId: 'modal', channelId: '456', user: { id: '789' }, deferReply: vi.fn(), editReply: vi.fn() };
    await new AddListModalHandler().handle({ interaction } as any);
    expect(recordEvent).toHaveBeenCalledTimes(mode === 'validation' ? 1 : 0);
    if (mode === 'validation') expect(recordEvent.mock.calls[0][0]).toMatchObject({ operationKind: 'AddListModalHandler', success: false, interactionId: '123' });
    else expect(fetcher).toHaveBeenCalledOnce();
  });
});
