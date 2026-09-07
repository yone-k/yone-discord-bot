import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreApiError, CoreClient } from '../../src/api/CoreClient';
import { RemindTaskUpdateSelectMenuHandler } from '../../src/selectmenus/RemindTaskUpdateSelectMenuHandler';
import { RemindTaskUpdateButtonHandler } from '../../src/buttons/RemindTaskUpdateButtonHandler';
import { Logger } from '../../src/utils/logger';
import { createRemindTask } from '../helpers/RemindTask';
import type { RemindTask } from '../../src/models/RemindTask';
import { delayedFetch, formInteraction } from '../helpers/FormInteraction';

function taskFixture(overrides: Partial<RemindTask> = {}): RemindTask {
  const date = new Date('2026-01-01T00:00:00Z');
  return createRemindTask({ id: 'task-1', title: '掃除', intervalDays: 7, timeOfDay: '09:00', remindBeforeMinutes: 60,
    startAt: date, nextDueAt: date, createdAt: date, updatedAt: date, ...overrides });
}

describe('繰り返し更新の初回応答', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const logger = (): Logger => {
    const value = new Logger();
    for (const level of ['debug', 'info', 'warn', 'error'] as const) vi.spyOn(value, level).mockImplementation(() => {});
    return value;
  };
  it('タスク取得を保留しても更新ボタンは即座にdeferする', async () => {
    let resolve!: (value: ReturnType<typeof createRemindTask>) => void;
    const repository = { findTaskByMessageId: vi.fn(() => new Promise(r => { resolve = r; })) };
    const interaction = formInteraction('remind-task-update');
    const log = logger();
    const outputs = { setCardView: vi.fn().mockResolvedValue({}) };
    const handler = new RemindTaskUpdateButtonHandler(log, undefined, undefined, repository as any, outputs);
    const pending = handler.handle({ interaction } as any);
    await Promise.resolve();
    expect(interaction.deferred).toBe(true);
    expect(interaction.editReply).not.toHaveBeenCalled();
    resolve(taskFixture());
    await pending;
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(outputs.setCardView).toHaveBeenCalledOnce();
    expect(vi.mocked(log.debug).mock.calls.map(call => (call[1] as any).stage)).toEqual(['received', 'initial_response', 'task_fetch', 'output_reservation']);
  });
  it.each(['missing', 'core', 'unexpected'])('defer後の失敗 %s は本人だけへ通知する', async failure => {
    const repository = { findTaskByMessageId: failure === 'missing' ? vi.fn().mockResolvedValue(null) : vi.fn().mockRejectedValue(failure === 'core' ? new CoreApiError('unavailable', 503) : new Error('broken')) };
    const interaction = formInteraction('remind-task-update');
    await new RemindTaskUpdateButtonHandler(logger(), undefined, undefined, repository as any).handle({ interaction } as any);
    expect(interaction.followUp).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ flags: ['Ephemeral'], content: expect.stringContaining('開き直') }));
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
  it('チャンネル情報のない更新ボタンはdeferせず理由を返信する', async () => {
    const interaction = formInteraction('remind-task-update');
    interaction.channelId = '';
    const repository = { findTaskByMessageId: vi.fn() };
    await new RemindTaskUpdateButtonHandler(logger(), undefined, undefined, repository as any).handle({ interaction } as any);
    expect(interaction.reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ flags: ['Ephemeral'] }));
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(repository.findTaskByMessageId).not.toHaveBeenCalled();
  });
  it.each(['no-link', 'empty', 'missing-id'])('在庫参照 %s の既存表示と不要な取得の省略を維持する', async mode => {
    const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true, metadata: { linkedInventoryChannelId: mode === 'no-link' ? undefined : 'inventory' } }) };
    const task = taskFixture({ inventoryItems: mode === 'empty' ? [] : [{ inventoryId: 'missing-123456', consume: '1.23456789' }, { inventoryId: 'found', consume: '2' }] });
    const inventory = { fetchAll: vi.fn().mockResolvedValue([{ id: 'found', name: 'a,"b', stock: '9007199254740993.12345', category: '' }]) };
    const interaction = formInteraction('remind-task-update-select:msg-1', 'inventory');
    await new RemindTaskUpdateSelectMenuHandler(logger(), undefined, metadata as any, { findTaskByMessageId: vi.fn().mockResolvedValue(task) } as any, { setCardView: vi.fn().mockResolvedValue({ success: true }) } as any, inventory).handle({ interaction } as any);
    const value = interaction.showModal.mock.calls[0][0].toJSON().components[0].components[0].value;
    if (mode === 'missing-id') {
      expect(inventory.fetchAll).toHaveBeenCalledExactlyOnceWith('inventory');
      expect(value).toBe('[不明な在庫:missing-],1.23456789\n"a,""b",9007199254740993.12345,2');
    } else {
      expect(inventory.fetchAll).not.toHaveBeenCalled();
      expect(value).toBe('');
    }
  });
  it.each(['basic', 'advanced', 'inventory'])('%s の表示復帰の予約が3秒を超えてもフォームと別操作を待たせない', async selection => {
    vi.useFakeTimers();
    const log = logger();
    const outputs = { setCardView: vi.fn(() => new Promise(resolve => setTimeout(() => resolve({ success: true }), 4000))) };
    const handler = new RemindTaskUpdateSelectMenuHandler(log, undefined, undefined, { findTaskByMessageId: vi.fn().mockResolvedValue(taskFixture()) } as any, outputs as any);
    const first = formInteraction('remind-task-update-select:msg-1', selection);
    const pending = handler.handle({ interaction: first } as any);
    await vi.advanceTimersByTimeAsync(0);
    expect(first.showModal).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3001);
    const second = formInteraction('remind-task-update-select:msg-2', selection);
    const other = handler.handle({ interaction: second } as any);
    await vi.advanceTimersByTimeAsync(0);
    expect(second.showModal).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    await Promise.all([pending, other]);
    const stages = vi.mocked(log.debug).mock.calls.map(call => call[1] as any);
    expect(stages.filter(x => x.messageId === 'msg-1').map(x => x.stage)).toEqual(['received', 'task_fetch', 'modal_prepare', 'initial_response', 'output_reservation']);
    expect(stages.find(x => x.stage === 'output_reservation')).toMatchObject({ stageElapsedMs: 4000, totalElapsedMs: 4000, replied: true, deferred: false, errorCode: null });
  });
  it.each(['missing', 'channel', 'message', 'empty', 'invalid'])('入力不備や対象不存在 %s を返信する', async failure => {
    const interaction = formInteraction(failure === 'message' ? 'remind-task-update-select:' : 'remind-task-update-select:msg-1');
    if (failure === 'channel') interaction.channelId = '';
    if (failure === 'empty') interaction.values = [];
    if (failure === 'invalid') interaction.values = ['unknown'];
    const repository = { findTaskByMessageId: vi.fn().mockResolvedValue(null) };
    await new RemindTaskUpdateSelectMenuHandler(logger(), undefined, undefined, repository as any).handle({ interaction } as any);
    expect(interaction.reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ flags: ['Ephemeral'] }));
    expect(interaction.showModal).not.toHaveBeenCalled();
    if (failure !== 'missing') expect(repository.findTaskByMessageId).not.toHaveBeenCalled();
  });
  it.each(['core', 'unexpected'])('フォーム表示後の表示復帰の予約失敗 %s はログのみ', async failure => {
    const log = logger();
    const outputs = { setCardView: vi.fn().mockRejectedValue(failure === 'core' ? new CoreApiError('unavailable', 503) : new Error('broken')) };
    const interaction = formInteraction('remind-task-update-select:msg-1');
    await new RemindTaskUpdateSelectMenuHandler(log, undefined, undefined, { findTaskByMessageId: vi.fn().mockResolvedValue(taskFixture()) } as any, outputs as any).handle({ interaction } as any);
    expect(interaction.showModal).toHaveBeenCalledOnce();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(log[failure === 'unexpected' ? 'error' : 'warn']).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stage: 'output_reservation', replied: true, errorCode: failure === 'core' ? 'unavailable' : null }));
  });
  it.each([false, true])('在庫20件を3通信で準備し、累積2秒の予算を守る（期限超過=%s）', async timeout => {
    vi.useFakeTimers();
    const inventory = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: `item${i}`, stock: '1', category: '' }));
    const task = taskFixture({ inventoryItems: inventory.map(x => ({ inventoryId: x.id, consume: '1' })) });
    const fetcher = delayedFetch({ '/task': { delay: 600, body: {} }, '/settings': { delay: 600, body: { success: true, metadata: { linkedInventoryChannelId: 'inventory' } } }, '/items': { delay: timeout ? 1000 : 600, body: inventory } });
    const client = new CoreClient('https://test.invalid', 'test', fetcher);
    const repository = { findTaskByMessageId: async (): Promise<RemindTask> => { await client.request('GET', '/task'); return task; } };
    const metadata = { getChannelMetadata: (): Promise<unknown> => client.request('GET', '/settings') };
    const inventoryRepository = { fetchAll: (): Promise<unknown> => client.request('GET', '/items') };
    const outputs = { setCardView: vi.fn().mockResolvedValue({ success: true }) };
    const interaction = formInteraction('remind-task-update-select:msg-1', 'inventory');
    const log = logger();
    const pending = new RemindTaskUpdateSelectMenuHandler(log, undefined, metadata as any, repository as any, outputs as any, inventoryRepository as any).handle({ interaction } as any);
    await vi.advanceTimersByTimeAsync(timeout ? 2000 : 1800);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(3);
    if (timeout) {
      expect(interaction.reply).toHaveBeenCalledOnce();
      expect(outputs.setCardView).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stage: 'modal_prepare', totalElapsedMs: 2000, errorCode: 'unavailable' }));
      await vi.advanceTimersByTimeAsync(5000);
      expect(interaction.showModal).not.toHaveBeenCalled();
    } else {
      expect(interaction.showModal).toHaveBeenCalledOnce();
      const modal = (interaction.showModal.mock.calls[0] as any)[0].toJSON();
      expect(modal.components[0].components[0].value.split('\n')).toHaveLength(20);
      expect(interaction.reply).not.toHaveBeenCalled();
    }
  });
});
