import { describe, it, expect, vi } from 'vitest';
import { RemindTaskCompleteButtonHandler } from '../../src/buttons/RemindTaskCompleteButtonHandler';
import { Logger } from '../../src/utils/logger';

describe('RemindTaskCompleteButtonHandler', () => {
  it('shows complete modal with message id', async () => {
    const handler = new RemindTaskCompleteButtonHandler(new Logger());
    const interaction = {
      customId: 'remind-task-complete',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      message: { id: 'msg-1' },
      showModal: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(interaction.showModal).toHaveBeenCalled();
  });
});
