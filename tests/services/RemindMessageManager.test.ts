import { describe, it, expect, vi } from 'vitest';
import { RemindMessageManager } from '../../src/services/RemindMessageManager';
import { EmbedBuilder } from 'discord.js';

describe('RemindMessageManager', () => {
  it('creates task message with buttons', async () => {
    const manager = new RemindMessageManager();
    const embed = new EmbedBuilder().setTitle('テスト');
    const mockMessage = { id: 'msg-1' };
    const mockChannel = {
      isTextBased: (): boolean => true,
      send: vi.fn().mockResolvedValue(mockMessage)
    };
    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(mockChannel)
      }
    };

    const result = await manager.createTaskMessage('channel-1', embed, mockClient as any);

    expect(result.success).toBe(true);
    expect(mockChannel.send).toHaveBeenCalled();
  });

  it('updates task message', async () => {
    const manager = new RemindMessageManager();
    const embed = new EmbedBuilder().setTitle('更新');
    const mockMessage = {
      edit: vi.fn().mockResolvedValue(undefined)
    };
    const mockChannel = {
      isTextBased: (): boolean => true,
      messages: {
        fetch: vi.fn().mockResolvedValue(mockMessage)
      }
    };
    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(mockChannel)
      }
    };

    const result = await manager.updateTaskMessage('channel-1', 'msg-1', embed, mockClient as any);

    expect(result.success).toBe(true);
    expect(mockMessage.edit).toHaveBeenCalled();
  });
});
