import { describe, it, expect, vi } from 'vitest';
import { ListChannelStore } from '../../src/services/ListChannelStore';
import { RemindChannelStore } from '../../src/services/RemindChannelStore';
import type { ListChannelRepository, RemindChannelRepository } from '../../src/repositories/contracts';

describe('DB channel settings', () => {
  it('updates only the changed message ID without replacing business settings', async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue({ channelId: '123', messageId: '456', listTitle: '買い物', defaultCategory: 'その他', operationLogThreadId: null, editVersion: '2' });
    const store = new ListChannelStore({ patch, get } as unknown as ListChannelRepository);
    await store.updateChannelMetadata('123', { messageId: '456' });
    expect(patch).toHaveBeenCalledWith('123', { messageId: '456' });
  });

  it('propagates DB outages rather than treating a configured channel as absent', async () => {
    const store = new ListChannelStore({ get: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as ListChannelRepository);
    await expect(store.getChannelMetadata('123')).rejects.toThrow('offline');
  });

  it('represents channels awaiting Discord creation without inventing a message ID or sync time', async () => {
    const get = vi.fn().mockResolvedValue({ channelId: '123', messageId: null, listTitle: '買い物', defaultCategory: 'その他', operationLogThreadId: null, editVersion: '0' });
    const store = new ListChannelStore({ get } as unknown as ListChannelRepository);
    expect(await store.getChannelMetadata('123')).toEqual({ success: true, metadata: {
      channelId: '123', messageId: '', listTitle: '買い物', defaultCategory: 'その他', operationLogThreadId: undefined
    } });
  });

  it('preserves link-deletion constraint errors for the command to report', async () => {
    const patch = vi.fn().mockRejectedValue(new Error('referenced inventory'));
    const store = new RemindChannelStore({ patch } as unknown as RemindChannelRepository);
    await expect(store.updateChannelMetadata('123', { linkedInventoryChannelId: '' })).rejects.toThrow('referenced inventory');
    expect(patch).toHaveBeenCalledWith('123', { linkedInventoryChannelId: null });
  });
});
