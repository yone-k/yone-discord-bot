import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModalSubmitInteraction } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { ModalManager } from '../../src/services/ModalManager';
import { registerAllModals } from '../../src/registry/RegisterModals';
import { Logger } from '../../src/utils/logger';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('registered delete-all modal → Core API', () => {
  it.each(['success', 'permission', 'offline', 'progress-offline'])('preserves defer, permissions and reply cleanup for %s', async mode => {
    vi.stubEnv('CORE_API_URL', 'http://core');
    vi.stubEnv('CORE_API_TOKEN', 'test');
    const order: string[] = [];
    const fetcher = vi.fn(async (_url: URL, options: RequestInit) => {
      order.push('api');
      expect(options.headers).toMatchObject({ 'X-Actor-Id': '200', 'X-Interaction-Id': '300', 'X-Operation-Kind': 'ConfirmationModalHandler' });
      if (mode === 'offline') throw new Error('response lost');
      if (mode === 'progress-offline') {
        if (order.filter(step => step === 'api').length > 1) throw new Error('progress unavailable');
        return new Response(JSON.stringify({ jobId: 'job', channelId: '100', state: 'pending', firstAttemptFinished: false, confirmedDeletedCount: 0, lastError: null }));
      }
      return new Response(JSON.stringify({ jobId: 'job', channelId: '100', state: 'succeeded', firstAttemptFinished: true, confirmedDeletedCount: 4, lastError: null }));
    });
    vi.stubGlobal('fetch', fetcher);
    const permissions = { has: vi.fn(() => mode !== 'permission') };
    const interaction = {
      id: '300', customId: 'confirmation-modal', user: { id: '200' }, channelId: '100', channel: { id: '100' },
      guild: { members: { fetch: vi.fn(async () => { order.push('permissions'); return { permissions }; }) } },
      deferReply: vi.fn(async () => { order.push('defer'); }),
      editReply: vi.fn(async () => { order.push('edit'); }),
      deleteReply: vi.fn(async () => { order.push('delete'); })
    };
    const manager = new ModalManager(new Logger());
    registerAllModals(manager, new Logger());
    await manager.handleModalSubmit(interaction as unknown as ModalSubmitInteraction);
    expect(interaction.deferReply).toHaveBeenCalledWith({});
    expect(permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.ManageMessages);
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
    if (mode === 'success') {
      expect(order).toEqual(['defer', 'permissions', 'api', 'edit', 'edit', 'delete']);
      expect(interaction.editReply).toHaveBeenNthCalledWith(1, { content: '✅ 4件のメッセージを削除しました。' });
      expect(interaction.editReply).toHaveBeenNthCalledWith(2, { content: '処理が完了しました。' });
    } else {
      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(mode === 'permission' ? 0 : mode === 'progress-offline' ? 2 : 1);
    }
  });
});
