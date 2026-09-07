import { execFileSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { coreClient } from '../../src/api/CoreClient';
import { RemindTaskAddModalHandler } from '../../src/modals/RemindTaskAddModalHandler';
import { RemindTaskCompleteButtonHandler } from '../../src/buttons/RemindTaskCompleteButtonHandler';
import { RemindTaskRepository } from '../../src/services/RemindTaskRepository';
import { Logger } from '../../src/utils/logger';

function query(sql: string): string {
  const raw = process.env.TEST_DATABASE_URL;
  const container = process.env.TEST_DB_CONTAINER_ID;
  if (!raw || !container || !process.env.API_INTEGRATION_CLUSTER_ID) throw new Error('Run through scripts/test-api-integration.mjs');
  const url = new URL(raw);
  if (!/^[a-z][a-z0-9_]*_http$/.test(url.pathname.slice(1))) throw new Error('Dedicated HTTP database required');
  return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD', container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', decodeURIComponent(url.username), '-d', url.pathname.slice(1)], {
    input: sql, encoding: 'utf8', timeout: 10000, env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }
  }).trim();
}

interface BoundaryState {
  creations: { id: string; nonce: string; payload: unknown }[];
  edits: { id: string; payload: unknown }[];
  errors: string[];
}

it('accepts real TS interactions using IDs saved by the Go worker, including replacement after Discord 404', async () => {
  expect(query('SELECT system_identifier::text FROM pg_control_system()')).toBe(process.env.API_INTEGRATION_CLUSTER_ID);
  const boundary = process.env.ISSUE44_RUNTIME_DISCORD;
  if (!boundary || process.env.DISCORD_OUTPUT_ENABLED !== 'true') throw new Error('Enabled output runtime required');
  await coreClient().assertReady();
  const state = async (): Promise<BoundaryState> => {
    const response = await fetch(`${boundary}/__test/state`);
    expect(response.ok).toBe(true);
    return await response.json() as BoundaryState;
  };
  // Existing channel avoids testing thread initialization in this card scenario.
  query('INSERT INTO remind_channels(channel_id,list_title) VALUES(\'920\',\'出力統合\');');
  const sharedEdit = vi.fn();
  const sharedSend = vi.fn();
  const channel = { id: '920', isThread: (): boolean => false, send: sharedSend };
  const fields: Record<string, string> = { title: 'フィルター交換', description: '実入力から作成', 'interval-days': '7', 'time-of-day': '09:00', 'remind-before': '00:00' };
  const modal = {
    id: '920001', customId: 'remind-task-add-modal', channelId: '920', channel, user: { id: '42' },
    fields: { getTextInputValue: (name: string): string => fields[name] },
    deferReply: vi.fn(), editReply: vi.fn(), deleteReply: vi.fn()
  };
  await new RemindTaskAddModalHandler(new Logger()).handle({ interaction: modal as unknown as ModalSubmitInteraction });
  expect(modal.editReply).not.toHaveBeenCalled();
  expect(modal.deleteReply).toHaveBeenCalledOnce();
  const repository = new RemindTaskRepository();
  const awaitCard = async (id: string): Promise<void> => {
    await vi.waitFor(async () => {
      expect((await repository.fetchTasks('920'))[0]?.messageId).toBe(id);
      expect(query('SELECT count(*) FROM output_tasks WHERE channel_id=\'920\' AND kind=\'task_card\' AND state NOT IN (\'succeeded\',\'cancelled\')')).toBe('0');
    }, { timeout: 10000, interval: 100 });
  };
  await awaitCard('92001');
  expect((await state()).creations).toHaveLength(1);
  expect(query('SELECT actor_id || \':\' || operation_kind || \':\' || success FROM operation_records WHERE interaction_id=\'920001\'')).toBe('42:RemindTaskAddModalHandler:true');
  expect(query('SELECT count(*) FROM output_dispatches WHERE outcome=\'succeeded\' AND discord_message_id=\'92001\'')).toBe('1');

  const complete = async (messageId: string, interactionId: string): Promise<void> => {
    const interaction = {
      id: interactionId, customId: 'remind-task-complete', channelId: '920', channel,
      message: { id: messageId, edit: sharedEdit }, user: { id: '42', bot: false }, deferred: false, replied: false,
      deferReply: vi.fn(), deleteReply: vi.fn(), editReply: vi.fn(), reply: vi.fn()
    };
    await new RemindTaskCompleteButtonHandler(new Logger()).handle({ interaction: interaction as unknown as ButtonInteraction });
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  };
  await complete('92001', '920002');
  await awaitCard('92001');
  expect((await repository.findTaskByMessageId('920', '92001'))?.revision).toBe('1');
  expect((await state()).edits.some(edit => edit.id === '92001')).toBe(true);

  // An external deletion makes the next real worker edit receive typed 10008.
  const removed = await fetch(`${boundary}/api/v10/channels/920/messages/92001`, { method: 'DELETE', headers: { Authorization: 'Bot integration-output-token' } });
  expect(removed.status).toBe(204);
  await complete('92001', '920003');
  await awaitCard('92002');
  expect(await repository.findTaskByMessageId('920', '92001')).toBeNull();
  expect(query('SELECT count(*) FROM output_dispatches WHERE outcome=\'succeeded\' AND discord_message_id=\'92002\'')).toBe('1');
  await complete('92002', '920004');
  await awaitCard('92002');
  expect((await repository.findTaskByMessageId('920', '92002'))?.revision).toBe('3');
  const final = await state();
  expect(final.creations.map(message => message.id)).toEqual(['92001', '92002']);
  expect(new Set(final.creations.map(message => message.nonce)).size).toBe(2);
  for (const message of final.creations) expect(JSON.stringify(message.payload)).toContain('remind-task-complete');
  expect(final.edits.some(edit => edit.id === '92002')).toBe(true);
  expect(final.errors).toEqual([]);
  expect(sharedEdit).not.toHaveBeenCalled();
  expect(sharedSend).not.toHaveBeenCalled();
}, 45000);
