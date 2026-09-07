import { describe, it, expect, vi } from 'vitest';
import { RemindInitializationService } from '../../src/services/RemindInitializationService';
import { CoreApiError } from '../../src/api/CoreClient';

describe('RemindInitializationService', () => {
  it.each([false, true])('saves settings before reserving output (existing=%s)', async existing => {
    const metadata = {
      getChannelMetadata: vi.fn().mockResolvedValue({ success: existing }),
      createChannelMetadata: vi.fn().mockResolvedValue({ success: true }),
      updateChannelMetadata: vi.fn().mockResolvedValue({ success: true })
    };
    const outputs = { initialize: vi.fn().mockResolvedValue({}) };
    const service = new RemindInitializationService(metadata as any, outputs);
    expect(await service.initialize('100', '家事リマインド')).toEqual({ success: true });
    const save = existing ? metadata.updateChannelMetadata : metadata.createChannelMetadata;
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(outputs.initialize.mock.invocationCallOrder[0]);
    expect(outputs.initialize).toHaveBeenCalledExactlyOnceWith('100', { kind: 'reminder' });
    if (existing) expect(save).toHaveBeenCalledWith('100', { listTitle: '家事リマインド' });
    else expect(save).toHaveBeenCalledWith('100', '家事リマインド');
  });
  it('propagates a rejected reservation without posting or retrying', async () => {
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true }), updateChannelMetadata: vi.fn().mockResolvedValue({ success: true }) };
    const error = new CoreApiError('conflict', 409);
    const outputs = { initialize: vi.fn().mockRejectedValue(error) };
    const service = new RemindInitializationService(metadata as any, outputs);
    await expect(service.initialize('100', '家事')).rejects.toBe(error);
    expect(outputs.initialize).toHaveBeenCalledOnce();
  });
});
