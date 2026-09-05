import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { ChannelType, type Client, type ModalSubmitInteraction, type ButtonInteraction } from 'discord.js';
import { applyMigrations } from '../../src/db/schema';
import { PostgresListRepository } from '../../src/repositories/PostgresListRepository';
import { PostgresListChannelRepository } from '../../src/repositories/PostgresListChannelRepository';
import { ListChannelStore } from '../../src/services/ListChannelStore';
import { MessageManager } from '../../src/services/MessageManager';
import { ListInitializationService } from '../../src/services/ListInitializationService';
import { ListDueReminderScheduler } from '../../src/services/ListDueReminderScheduler';
import { EditListButtonHandler } from '../../src/buttons/EditListButtonHandler';
import { AddListModalHandler } from '../../src/modals/AddListModalHandler';
import { EditListModalHandler } from '../../src/modals/EditListModalHandler';
import { Logger } from '../../src/utils/logger';
import { testPool, resetDatabase } from './helpers';
describe('一覧BotとPostgreSQLの業務回帰', () => {
  const pool = testPool();
  const repository = new PostgresListRepository(pool);
  const channels = new PostgresListChannelRepository(pool);
  const metadata = new ListChannelStore(channels);
  const logger = new Logger();
  const now = new Date('2026-09-05T12:00:00.000Z');
  beforeAll(async () => { await resetDatabase(pool); await applyMigrations(pool); });
  beforeEach(async () => { await pool.query('TRUNCATE list_channels CASCADE'); });
  afterAll(async () => { await pool.end(); });
  async function setup(): Promise<{
        client: Client;
        service: ListInitializationService;
        send: ReturnType<typeof vi.fn>;
        edit: ReturnType<typeof vi.fn>;
        threadSend: ReturnType<typeof vi.fn>;
        submit: (kind: 'add' | 'edit', text: string, customId?: string, userId?: string) => Promise<string>;
        open: () => Promise<string>;
    }> {
    const edit = vi.fn();
    const message = { id: '99', pinned: true, edit };
    edit.mockResolvedValue(message);
    const send = vi.fn().mockResolvedValue(message);
    const threadSend = vi.fn().mockResolvedValue({ id: '100' });
    const channel = { id: '1', name: '買物', type: ChannelType.GuildText, send, messages: { fetch: vi.fn().mockResolvedValue(message) } };
    const client = { channels: { fetch: vi.fn().mockImplementation(async (id: string) => id === '2' ? { send: threadSend } : channel) } } as unknown as Client;
    const messages = new MessageManager(metadata);
    const service = new ListInitializationService(repository, messages, metadata);
    await service.initializeList({ channelId: '1', interaction: { channel, client } as any }, false, '食品');
    await metadata.updateChannelMetadata('1', { operationLogThreadId: '2' });
    const add = new AddListModalHandler(logger, repository, messages, metadata);
    const editor = new EditListModalHandler(logger, repository, messages, metadata);
    const button = new EditListButtonHandler(logger, undefined, metadata, repository);
    const submit = async (kind: 'add' | 'edit', text: string, customId = 'add-list-modal', userId = '3'): Promise<string> => {
      const reply = vi.fn();
      const interaction = { customId, channelId: '1', user: { id: userId }, fields: { getTextInputValue: (key: string) => key === 'category' ? '' : text },
        client, deferReply: vi.fn(), editReply: reply } as unknown as ModalSubmitInteraction;
      await (kind === 'add' ? add : editor).handle({ interaction });
      return reply.mock.calls.at(-1)?.[0].content as string;
    };
    const open = async (): Promise<string> => {
      const showModal = vi.fn();
      await button.handle({ interaction: { customId: 'edit-list-button', channelId: '1', user: { id: '3' }, showModal } as unknown as ButtonInteraction });
      return showModal.mock.calls[0][0].toJSON().custom_id as string;
    };
    return { client, service, send, edit, threadSend, submit, open };
  }
  it('初期化で親設定と表示IDを保存し再描画では版を変えない', async () => {
    const { service, client, send, edit } = await setup();
    const before = await channels.get('1');
    expect(before).toMatchObject({ messageId: '99', defaultCategory: '食品' });
    await service.initializeList({ channelId: '1', interaction: { client, channel: { name: '別名' } } as any }, null, '食品', true);
    expect(await channels.get('1')).toEqual(before);
    expect(send).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledOnce();
    expect(JSON.stringify(edit.mock.calls[0])).not.toContain('スプレッドシート');
  });
  it('複数追加とCSV完了編集を保存しDiscordへ反映する', async () => {
    const { submit, open, edit } = await setup();
    expect(await submit('add', '牛乳,2026-09-05\nパン')).toContain('追加しました');
    const first = await repository.fetchAll('1');
    expect(first.map(item => item.name)).toEqual(['牛乳', 'パン']);
    expect(first[0].category).toBeNull();
    const customId = await open();
    expect(await submit('edit', '牛乳,,2026-09-05,1\nパン,,,', customId)).toContain('更新しました');
    const saved = await repository.fetchAll('1');
    expect(saved[0]).toMatchObject({ id: first[0].id, isCompleted: true });
    expect(JSON.stringify(edit.mock.calls.at(-1))).toContain('~~牛乳 (期限: 9/5)~~');
  });
  it('編集画面を開いてから期限通知しても同じ版で保存し通知日時を保持する', async () => {
    const { submit, open, client, threadSend } = await setup();
    await submit('add', '牛乳,2026-09-05');
    const customId = await open();
    await new ListDueReminderScheduler(metadata, repository).runOnce(client, now);
    expect(threadSend).toHaveBeenCalledOnce();
    expect(await submit('edit', '牛乳,飲物,2026-09-05,', customId)).toContain('更新しました');
    expect((await repository.fetchAll('1'))[0]).toMatchObject({ category: '飲物', lastNotifiedAt: now });
    await new ListDueReminderScheduler(metadata, repository).runOnce(client, now);
    expect(threadSend).toHaveBeenCalledOnce();
  });
  it('古い版は全件拒否し新しい追加を失わない', async () => {
    const { submit, open, edit } = await setup();
    await submit('add', '牛乳');
    const customId = await open();
    await submit('add', 'パン');
    const renders = edit.mock.calls.length;
    expect(await submit('edit', '', customId)).toContain('開き直');
    expect((await repository.fetchAll('1')).map(item => item.name)).toEqual(['牛乳', 'パン']);
    expect(edit.mock.calls.length).toBe(renders);
  });
  it('名称変更は新しいUUIDと未通知状態になり空CSVで全削除できる', async () => {
    const { submit, open, client } = await setup();
    await submit('add', '牛乳,2026-09-05');
    await new ListDueReminderScheduler(metadata, repository).runOnce(client, now);
    const old = (await repository.fetchAll('1'))[0];
    await submit('edit', '豆乳,,2026-09-05,', await open());
    const renamed = (await repository.fetchAll('1'))[0];
    expect(renamed.id).not.toBe(old.id);
    expect(renamed.lastNotifiedAt).toBeNull();
    await submit('edit', '', await open());
    expect(await repository.fetchAll('1')).toEqual([]);
  });
  it('不正CSVと他人の送信でDBを変えない', async () => {
    const { submit, open } = await setup();
    await submit('add', '牛乳');
    const customId = await open();
    const before = await repository.snapshot('1');
    expect(await submit('edit', '牛乳,,,\n牛乳,,,', customId)).toContain('2行目');
    expect(await submit('edit', '', customId, '4')).toContain('使用できません');
    expect(await repository.snapshot('1')).toEqual(before);
  });
  it('Discord描画失敗時にも確定済みDBを保持して再描画を案内する', async () => {
    const { submit, client } = await setup();
    vi.mocked(client.channels.fetch).mockRejectedValue(new Error('Discord offline'));
    expect(await submit('add', '牛乳')).toContain('追加は完了しました');
    expect((await repository.fetchAll('1')).map(item => item.name)).toEqual(['牛乳']);
  });
  it('通知送信失敗時にはDBの通知日時を更新しない', async () => {
    const { submit, client, threadSend } = await setup();
    await submit('add', '牛乳,2026-09-05');
    threadSend.mockRejectedValue(new Error('Discord offline'));
    await new ListDueReminderScheduler(metadata, repository).runOnce(client, now);
    expect((await repository.fetchAll('1'))[0].lastNotifiedAt).toBeNull();
  });
  it('前後空白を含む名称の無編集CSV保存でUUIDとカテゴリを保持する', async () => {
    const {submit, open} = await setup();
    const original = await repository.append('1',{name:' milk ',category:' food ',until:null,isCompleted:false});
    const customId = await open();
    expect(await submit('edit','" milk "," food ",,',customId)).toContain('更新しました');
    expect((await repository.fetchAll('1'))[0]).toMatchObject({id:original.id,name:' milk ',category:' food '});
  });
});
