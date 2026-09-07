import { describe, expect, it, vi } from 'vitest';
import { RemindTaskService } from '../../src/services/RemindTaskService';
import { createRemindTask } from '../helpers/RemindTask';
function setup(): any {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const task = createRemindTask({ id: 'server-id', revision: '25', title: '米', intervalDays: 1, timeOfDay: '00:00', remindBeforeMinutes: 1440, startAt: now, nextDueAt: now, createdAt: now, updatedAt: now });
  const repository = { appendTask: vi.fn().mockResolvedValue(task), patchTask: vi.fn() };
  const metadata = { getChannelMetadata: vi.fn().mockResolvedValue({ success: true }), createChannelMetadata: vi.fn() };
  return { task, repository, metadata, service: new RemindTaskService(repository as any, metadata as any) };
}
describe('task creation UI orchestration', () => {
  it('returns the committed backend task without Discord calls or a message ID patch', async () => {
    const x = setup();
    const result = await x.service.addTask('channel', { title: '米', intervalDays: 1 });
    expect(x.repository.appendTask).toHaveBeenCalledExactlyOnceWith('channel', { title: '米', description: null, intervalDays: 1, timeOfDay: '00:00', remindBeforeMinutes: 1440, inventoryItems: [] });
    expect(result).toEqual({ success: true, task: x.task });
    expect(x.repository.patchTask).not.toHaveBeenCalled();
  });
  it('creates missing channel settings before creating a task', async () => {
    const x = setup();
    x.metadata.getChannelMetadata.mockResolvedValue({ success: false });
    await x.service.addTask('channel', { title: '米', intervalDays: 1 });
    expect(x.metadata.createChannelMetadata.mock.invocationCallOrder[0]).toBeLessThan(x.repository.appendTask.mock.invocationCallOrder[0]);
  });
  it('propagates creation failure without replaying the mutation', async () => {
    const x = setup();
    const error = new Error('conflict');
    x.repository.appendTask.mockRejectedValue(error);
    await expect(x.service.addTask('channel', { title: '米', intervalDays: 1 })).rejects.toBe(error);
    expect(x.repository.appendTask).toHaveBeenCalledOnce();
    expect(x.repository.patchTask).not.toHaveBeenCalled();
  });
});
