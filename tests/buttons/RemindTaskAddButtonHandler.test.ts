import { describe, it, expect, vi } from 'vitest';
import { RemindTaskAddButtonHandler } from '../../src/buttons/RemindTaskAddButtonHandler';
import { Logger } from '../../src/utils/logger';

describe('RemindTaskAddButtonHandler', () => {
  it('shows add modal', async () => {
    const handler = new RemindTaskAddButtonHandler(new Logger());
    const interaction = {
      customId: 'remind-task-add',
      user: { id: 'user-1', bot: false },
      channelId: 'channel-1',
      showModal: vi.fn()
    };

    await handler.handle({ interaction } as any);

    expect(interaction.showModal).toHaveBeenCalled();
  });
});
