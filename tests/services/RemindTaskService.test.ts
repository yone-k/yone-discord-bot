import { describe, expect, it, vi } from 'vitest';
import { RemindTaskService } from '../../src/services/RemindTaskService';
import { createRemindTask } from '../helpers/RemindTask';
function setup(): any {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const task = createRemindTask({ id: 'server-id', revision: '25', title: '米', intervalDays: 1, timeOfDay: '00:00', remindBeforeMinutes: 1440, startAt: now, nextDueAt: now, createdAt: now, updatedAt: now });
  const updated = { ...task, revision: '26', messageId: 'message' };
  const repository = { appendTask: vi.fn().mockResolvedValue(task), patchTask: vi.fn().mockResolvedValue({ success: true, task: updated }) };
  const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true }), createChannelMetadata: vi.fn() };
  const messages = { createTaskMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'message' }), updateTaskMessage: vi.fn().mockResolvedValue({ success: true }) };
  const logger = { warn: vi.fn() };
  return { task, updated, repository, metadata, messages, logger, service: new RemindTaskService(repository as any, metadata as any, messages as any, logger) };
}
describe('task creation UI orchestration', () => {
  it('uses backend ID, dates and revision without editing an unchanged new card', async () => {
    const x = setup();
    const result = await x.service.addTask('channel', { title: '米', intervalDays: 1 }, {} as any);
    expect(x.repository.appendTask).toHaveBeenCalledWith('channel', { title: '米', description: null, intervalDays: 1, timeOfDay: '00:00', remindBeforeMinutes: 1440, inventoryItems: [] });
    expect(x.repository.patchTask).toHaveBeenCalledWith('channel', x.task, { messageId: 'message' });
    expect(result.task).toEqual(x.updated);
    expect(x.messages.createTaskMessage.mock.calls[0][1]).toEqual(x.task);
    expect(x.messages.updateTaskMessage).not.toHaveBeenCalled();
  });
  it('creates missing channel settings before creating a task', async () => {
    const x = setup();
    x.metadata.getChannelMetadata.mockResolvedValue({ success: false });
    await x.service.addTask('channel', { title: '米', intervalDays: 1 }, {} as any);
    expect(x.metadata.createChannelMetadata.mock.invocationCallOrder[0]).toBeLessThan(x.repository.appendTask.mock.invocationCallOrder[0]);
  });
  it('reports a saved task with failed Discord rendering without replaying creation', async () => {
    const x = setup();
    x.messages.createTaskMessage.mockResolvedValue({ success: false } as any);
    const result = await x.service.addTask('channel', { title: '米', intervalDays: 1 }, {} as any);
    expect(result.message).toContain('タスクは保存されました');
    expect(x.repository.appendTask).toHaveBeenCalledTimes(1);
    expect(x.repository.patchTask).not.toHaveBeenCalled();
    expect(x.logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stage: 'create_message', taskId: 'server-id' }));
  });
  it('does not replay creation or patch when message persistence has an uncertain result', async () => {
    const x = setup();
    x.repository.patchTask.mockRejectedValue(new Error('更新結果を確認できません'));
    const result = await x.service.addTask('channel', { title: '米', intervalDays: 1 }, {} as any);
    expect(result.success).toBe(false);
    expect(result.message).toContain('タスクは保存されました');
    expect(x.repository.appendTask).toHaveBeenCalledTimes(1);
    expect(x.repository.patchTask).toHaveBeenCalledTimes(1);
    expect(x.messages.updateTaskMessage).not.toHaveBeenCalled();
    expect(x.logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stage: 'save_message_id', taskId: 'server-id', errorType: 'Error' }));
  });
  it('reports saved state when card creation rejects', async () => {
    const x = setup();
    x.messages.createTaskMessage.mockRejectedValue(new Error('Discord connection lost'));
    const result = await x.service.addTask('channel', { title: '米', intervalDays: 1 }, {} as any);
    expect(result.success).toBe(false);
    expect(result.message).toContain('タスクは保存されました');
    expect(result.message).toContain('初期化');
    expect(x.repository.appendTask).toHaveBeenCalledTimes(1);
  });
});
