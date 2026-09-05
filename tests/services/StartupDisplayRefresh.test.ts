import { describe, it, expect, vi } from 'vitest';
import { refreshStoredDisplays } from '../../src/services/StartupDisplayRefresh';

describe('startup display refresh', () => {
  it('refreshes every registered display before resolving and reports individual failures', async () => {
    const render = vi.fn().mockRejectedValueOnce(new Error('Discord denied')).mockResolvedValue(undefined);
    const work = { list: async (): Promise<{ channelId: string }[]> => [{ channelId: '1' }, { channelId: '2' }], render };
    const failures = await refreshStoredDisplays([work]);
    expect(render.mock.calls.map(call => call[0].channelId)).toEqual(['1', '2']);
    expect(failures).toEqual([{ channelId: '1', message: 'Discord denied' }]);
  });
  it('does not treat failed database enumeration as a successful empty refresh', async () => {
    const render = vi.fn();
    await expect(refreshStoredDisplays([{ list: async (): Promise<never> => { throw new Error('DB offline'); }, render }])).rejects.toThrow('DB offline');
    expect(render).not.toHaveBeenCalled();
  });
});
