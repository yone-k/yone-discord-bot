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

  it('sends reminder to existing thread', async () => {
    const manager = new RemindMessageManager();
    const mockThread = {
      send: vi.fn().mockResolvedValue(undefined),
      archived: false
    };
    const mockMessage = {
      thread: mockThread,
      hasThread: true,
      startThread: vi.fn()
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

    const result = await manager.sendReminderToThread(
      'channel-1',
      'msg-1',
      '@everyone ⌛ リマインド: 掃除',
      mockClient as any
    );

    expect(result.success).toBe(true);
    expect(mockThread.send).toHaveBeenCalledWith('@everyone ⌛ リマインド: 掃除');
    expect(mockMessage.startThread).not.toHaveBeenCalled();
  });

  it('creates thread when missing and sends reminder', async () => {
    const manager = new RemindMessageManager();
    const mockThread = {
      send: vi.fn().mockResolvedValue(undefined)
    };
    const mockMessage = {
      thread: null,
      hasThread: false,
      startThread: vi.fn().mockResolvedValue(mockThread)
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

    const result = await manager.sendReminderToThread(
      'channel-1',
      'msg-1',
      '@everyone ❗ 期限超過: 掃除',
      mockClient as any
    );

    expect(result.success).toBe(true);
    expect(mockMessage.startThread).toHaveBeenCalledWith({
      name: 'リマインド通知',
      autoArchiveDuration: 1440
    });
    expect(mockThread.send).toHaveBeenCalledWith('@everyone ❗ 期限超過: 掃除');
  });
});
