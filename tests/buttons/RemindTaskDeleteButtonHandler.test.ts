import { describe, it, expect, vi } from 'vitest';
import { RemindTaskDeleteButtonHandler } from '../../src/buttons/RemindTaskDeleteButtonHandler';
import { Logger } from '../../src/utils/logger';

describe('RemindTaskDeleteButtonHandler', () => {
  it('shows delete modal with message id', async () => {
    const handler = new RemindTaskDeleteButtonHandler(new Logger());
    const interaction = {
      customId: 'remind-task-delete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      showModal: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(interaction.showModal).toHaveBeenCalled();
  });
});
