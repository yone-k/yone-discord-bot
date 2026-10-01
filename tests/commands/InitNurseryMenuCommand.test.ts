import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../../src/utils/logger';
import { InitNurseryMenuCommand } from '../../src/commands/InitNurseryMenuCommand';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';

function interaction(): any {
  const value: any = {
    id: '1000',
    user: { id: '999' },
    deferred: false,
    replied: false,
    deferReply: vi.fn(async () => { value.deferred = true; }),
    fetchReply: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn()
  };
  return value;
}

describe('InitNurseryMenuCommand', () => {
  let repository: { setChannel: ReturnType<typeof vi.fn> };
  let command: InitNurseryMenuCommand;

  beforeEach(() => {
    repository = { setChannel: vi.fn().mockResolvedValue(undefined) };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    command = new InitNurseryMenuCommand(logger as unknown as Logger, repository);
  });

  it('registers the current channel privately and removes the reply without a thread', async () => {
    const context: CommandExecutionContext = { channelId: '100', userId: '999', interaction: interaction() };

    const result = await command.safeExecute(context);

    expect(result.success).toBe(true);
    expect(repository.setChannel).toHaveBeenCalledWith('100');
    expect(context.interaction?.deferReply).toHaveBeenCalledTimes(1);
    expect(context.interaction?.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(context.interaction?.fetchReply).not.toHaveBeenCalled();
    expect(context.interaction?.deleteReply).toHaveBeenCalled();
  });

  it('fails without a channel', async () => {
    const result = await command.safeExecute({ userId: '999', interaction: interaction() });
    expect(result.success).toBe(false);
    expect(repository.setChannel).not.toHaveBeenCalled();
  });
});
