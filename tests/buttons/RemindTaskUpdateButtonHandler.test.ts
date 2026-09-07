import { describe, it, expect, vi } from 'vitest';
import { RemindTaskUpdateButtonHandler } from '../../src/buttons/RemindTaskUpdateButtonHandler';
import { Logger } from '../../src/utils/logger';

describe('RemindTaskUpdateButtonHandler', () => {
  it('acknowledges before lookup and reserves the shared card view in Go', async () => {
    const repository = { findTaskByMessageId: vi.fn().mockResolvedValue({ id: 'task-1', messageId: '300' }) };
    const outputs = { setCardView: vi.fn().mockResolvedValue({}) };
    const handler = new RemindTaskUpdateButtonHandler(new Logger(), undefined, undefined, repository as any, outputs);
    const interaction = {
      customId: 'remind-task-update', user: { id: '999', bot: false },
      channelId: '100', message: { id: '300' }, deferUpdate: vi.fn().mockResolvedValue(undefined),
      update: vi.fn(), editReply: vi.fn()
    };
    await handler.handle({ interaction } as any);
    expect(interaction.deferUpdate.mock.invocationCallOrder[0]).toBeLessThan(repository.findTaskByMessageId.mock.invocationCallOrder[0]);
    expect(repository.findTaskByMessageId).toHaveBeenCalledWith('100', '300');
    expect(outputs.setCardView).toHaveBeenCalledWith('100', 'task', 'task-1', { mode: 'update_selection' });
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
