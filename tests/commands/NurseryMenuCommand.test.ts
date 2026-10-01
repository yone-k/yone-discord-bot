import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { Logger } from '../../src/utils/logger';
import { NurseryMenuCommand } from '../../src/commands/NurseryMenuCommand';
import type { CommandExecutionContext } from '../../src/base/BaseCommand';

function interaction(options: { day?: string | null; date?: string | null } = {}): any {
  const value: any = {
    id: '1000',
    user: { id: '999' },
    deferred: false,
    replied: false,
    options: { getString: vi.fn((name: 'day' | 'date') => options[name] ?? null) },
    deferReply: vi.fn(async () => { value.deferred = true; }),
    fetchReply: vi.fn(),
    editReply: vi.fn()
  };
  return value;
}

describe('NurseryMenuCommand', () => {
  let repository: { get: ReturnType<typeof vi.fn> };
  let command: NurseryMenuCommand;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T15:30:00.000Z')); // 2026-10-02 00:30 JST
    repository = { get: vi.fn().mockResolvedValue({ date: '2026-10-02', lunch: 'ご飯', snack: '牛乳' }) };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    command = new NurseryMenuCommand(logger as unknown as Logger, repository);
  });
  afterEach(() => { vi.useRealTimers(); });

  async function run(options: { day?: string | null; date?: string | null } = {}): Promise<{ context: CommandExecutionContext; success: boolean }> {
    const context: CommandExecutionContext = { channelId: '100', userId: '999', interaction: interaction(options) };
    const result = await command.safeExecute(context);
    return { context, success: result.success };
  }

  it('shows today on the Tokyo calendar privately as a card without a thread', async () => {
    const { context, success } = await run();
    expect(success).toBe(true);
    expect(repository.get).toHaveBeenCalledWith('2026-10-02');
    expect(context.interaction?.deferReply).toHaveBeenCalledTimes(1);
    expect(context.interaction?.deferReply).toHaveBeenCalledWith({ flags: ['Ephemeral'] });
    expect(context.interaction?.fetchReply).not.toHaveBeenCalled();
    const reply = (context.interaction?.editReply as any).mock.calls[0][0];
    expect(reply.flags).toBe(MessageFlags.IsComponentsV2);
    expect(reply.components[0].toJSON().components[0].content).toBe('## 🍱 10/2(金) の献立');
  });

  it.each([
    [{ day: 'tomorrow' }, '2026-10-03'],
    [{ day: 'today' }, '2026-10-02'],
    [{ date: '2026-11-30' }, '2026-11-30']
  ])('looks up %o', async (options, date) => {
    await run(options);
    expect(repository.get).toHaveBeenCalledWith(date);
  });

  it('says when the day has no menu', async () => {
    repository.get.mockResolvedValue(null);
    const { context, success } = await run({ date: '2026-10-04' });
    expect(success).toBe(true);
    expect(context.interaction?.editReply).toHaveBeenCalledWith({ content: '10/4(日) の献立は登録されていません' });
  });

  it.each([
    [{ day: 'today', date: '2026-10-02' }, 'day と date はどちらか一方だけ指定してください。'],
    [{ date: '2026-02-30' }, 'date は YYYY-MM-DD 形式の実在する日付で指定してください。']
  ])('rejects %o before calling the API', async (options, message) => {
    const context: CommandExecutionContext = { channelId: '100', userId: '999', interaction: interaction(options) };
    const result = await command.safeExecute(context);
    expect(result.success).toBe(false);
    expect(result.error?.userMessage).toBe(message);
    expect(repository.get).not.toHaveBeenCalled();
    expect(context.interaction?.deferReply).not.toHaveBeenCalled();
  });
});
