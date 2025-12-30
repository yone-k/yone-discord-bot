import { describe, it, expect, vi } from 'vitest';
import { RemindMessageManager } from '../../src/services/RemindMessageManager';
import { ComponentType, MessageFlags } from 'discord.js';
import { createRemindTask, type RemindTask } from '../../src/models/RemindTask';

describe('RemindMessageManager', () => {
  const createTask = (): { now: Date; task: RemindTask } => {
    const now = new Date('2025-01-01T00:00:00.000Z');
    return {
      now,
      task: createRemindTask({
        id: 'task-1',
        title: 'テスト',
        description: '説明',
        intervalDays: 1,
        timeOfDay: '00:00',
        remindBeforeMinutes: 0,
        startAt: new Date('2025-01-01T00:00:00.000Z'),
        nextDueAt: new Date('2025-01-02T00:00:00.000Z'),
        createdAt: now,
        updatedAt: now
      })
    };
  };

  it('creates task message with V2 components', async () => {
    const manager = new RemindMessageManager();
    const { task, now } = createTask();
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

    const result = await manager.createTaskMessage('channel-1', task, mockClient as any, now);

    expect(result.success).toBe(true);
    expect(mockChannel.send).toHaveBeenCalled();
    const payload = mockChannel.send.mock.calls[0][0];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components).toHaveLength(1);
    const container = payload.components[0];
    expect(container.type).toBe(ComponentType.Container);
    const textContents = container.components
      .filter((component: any) => component.type === ComponentType.TextDisplay)
      .map((component: any) => component.content);
    expect(textContents.some((content: string) => content.startsWith('## '))).toBe(true);
    expect(textContents.some((content: string) => content.includes('テスト'))).toBe(true);
    expect(textContents.some((content: string) => content.includes('```'))).toBe(true);
    expect(textContents.some((content: string) => content.includes('█') || content.includes('░'))).toBe(true);
    expect(textContents.some((content: string) => content.includes('期限') || content.includes('残り'))).toBe(true);
    const actionRow = container.components.find(
      (component: any) => component.type === ComponentType.ActionRow
    );
    expect(actionRow?.components?.map((component: any) => component.custom_id)).toEqual([
      'remind-task-detail',
      'remind-task-update',
      'remind-task-complete',
      'remind-task-delete'
    ]);
  });

  it('updates task message with V2 components', async () => {
    const manager = new RemindMessageManager();
    const { task, now } = createTask();
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

    const result = await manager.updateTaskMessage('channel-1', 'msg-1', task, mockClient as any, now);

    expect(result.success).toBe(true);
    expect(mockMessage.edit).toHaveBeenCalled();
    const payload = mockMessage.edit.mock.calls[0][0];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components).toHaveLength(1);
    expect(payload.embeds).toEqual([]);
  });

  it('sends reminder to existing thread', async () => {
    const manager = new RemindMessageManager();
    const mockThread = {
      id: 'thread-1',
      send: vi.fn().mockResolvedValue(undefined),
      archived: false,
      isThread: (): boolean => true
    };
    const mockParentMessage = { id: 'msg-1' };
    const mockChannel = {
      isTextBased: (): boolean => true,
      messages: {
        fetch: vi.fn().mockResolvedValue(mockParentMessage)
      }
    };
    const mockFetch = vi.fn(async (id: string) => {
      if (id === 'channel-1') {
        return mockChannel;
      }
      if (id === 'thread-1') {
        return mockThread;
      }
      return null;
    });
    const mockClient = {
      channels: {
        fetch: mockFetch
      }
    };

    const result = await manager.sendReminderToThread(
      'channel-1',
      'thread-1',
      'msg-1',
      '@everyone ⌛ リマインド: 掃除',
      mockClient as any
    );

    expect(result.success).toBe(true);
    expect(mockThread.send).toHaveBeenCalledWith('@everyone ⌛ リマインド: 掃除');
  });

  it('recreates thread when parent message is missing', async () => {
    const manager = new RemindMessageManager();
    const mockThread = {
      id: 'thread-1',
      archived: false,
      isThread: (): boolean => true,
      send: vi.fn().mockResolvedValue(undefined)
    };
    const mockNewThread = {
      id: 'thread-2',
      archived: false,
      isThread: (): boolean => true,
      send: vi.fn().mockResolvedValue(undefined)
    };
    const mockParentMessage = {
      id: 'msg-new',
      pin: vi.fn().mockResolvedValue(undefined),
      startThread: vi.fn().mockResolvedValue(mockNewThread)
    };
    const mockChannel = {
      isTextBased: (): boolean => true,
      messages: {
        fetch: vi.fn().mockRejectedValue(new Error('Unknown Message'))
      },
      send: vi.fn().mockResolvedValue(mockParentMessage)
    };
    const mockFetch = vi.fn(async (id: string) => {
      if (id === 'channel-1') {
        return mockChannel;
      }
      if (id === 'thread-1') {
        return mockThread;
      }
      if (id === 'thread-2') {
        return mockNewThread;
      }
      return null;
    });
    const mockClient = {
      channels: {
        fetch: mockFetch
      }
    };

    const result = await manager.sendReminderToThread(
      'channel-1',
      'thread-1',
      'msg-old',
      '@everyone ⌛ リマインド: 掃除',
      mockClient as any
    );

    expect(result.success).toBe(true);
    expect(mockChannel.send).toHaveBeenCalled();
    expect(mockNewThread.send).toHaveBeenCalledWith('@everyone ⌛ リマインド: 掃除');
  });

  it('creates thread when missing and sends reminder', async () => {
    const manager = new RemindMessageManager();
    const mockThread = {
      id: 'thread-2',
      send: vi.fn().mockResolvedValue(undefined),
      archived: false,
      isThread: (): boolean => true
    };
    const mockParentMessage = {
      id: 'msg-2',
      pin: vi.fn().mockResolvedValue(undefined),
      startThread: vi.fn().mockResolvedValue(mockThread)
    };
    const mockChannel = {
      isTextBased: (): boolean => true,
      send: vi.fn().mockResolvedValue(mockParentMessage)
    };
    const mockFetch = vi.fn(async (id: string) => {
      if (id === 'channel-1') {
        return mockChannel;
      }
      if (id === 'thread-2') {
        return mockThread;
      }
      return null;
    });
    const mockClient = {
      channels: {
        fetch: mockFetch
      }
    };

    const result = await manager.sendReminderToThread(
      'channel-1',
      undefined,
      undefined,
      '@everyone ❗ 期限超過: 掃除',
      mockClient as any
    );

    expect(result.success).toBe(true);
    expect(mockParentMessage.startThread).toHaveBeenCalledWith({
      name: '通知用スレッド',
      autoArchiveDuration: 1440
    });
    expect(mockThread.send).toHaveBeenCalledWith('@everyone ❗ 期限超過: 掃除');
  });

  it('creates reminder thread parent message with V2 components and sheet link', async () => {
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/test-spreadsheet-id/edit#gid=0';
    const manager = new RemindMessageManager({
      sheetUrlResolver: async (): Promise<string> => sheetUrl
    });
    const mockThread = {
      id: 'thread-1',
      archived: false,
      isThread: (): boolean => true
    };
    const mockParentMessage = {
      id: 'msg-1',
      pin: vi.fn().mockResolvedValue(undefined),
      startThread: vi.fn().mockResolvedValue(mockThread)
    };
    const mockChannel = {
      isTextBased: (): boolean => true,
      send: vi.fn().mockResolvedValue(mockParentMessage)
    };
    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(mockChannel)
      }
    };

    const result = await manager.ensureReminderThread('channel-1', mockClient as any);

    expect(result.success).toBe(true);
    const payload = mockChannel.send.mock.calls[0][0];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components).toHaveLength(1);
    const container = payload.components[0];
    expect(container.type).toBe(ComponentType.Container);
    const textContents = container.components
      .filter((component: any) => component.type === ComponentType.TextDisplay)
      .map((component: any) => component.content);
    expect(textContents.some((content: string) => content.includes('### 通知用スレッド'))).toBe(true);
    expect(textContents.some((content: string) => content.includes('[スプレッドシートを開く]'))).toBe(true);
    expect(textContents.some((content: string) => content.includes(sheetUrl))).toBe(true);
    const actionRow = container.components.find(
      (component: any) => component.type === ComponentType.ActionRow
    );
    expect(actionRow?.components?.[0]?.custom_id).toBe('remind-task-add');
  });

  it('updates parent message to add button when missing', async () => {
    const manager = new RemindMessageManager();
    const mockThread = {
      id: 'thread-1',
      archived: false,
      isThread: (): boolean => true
    };
    const mockParentMessage = {
      id: 'msg-1',
      content: '旧メッセージ',
      components: [],
      edit: vi.fn().mockResolvedValue(undefined)
    };
    const mockChannel = {
      isTextBased: (): boolean => true,
      messages: {
        fetch: vi.fn().mockResolvedValue(mockParentMessage)
      }
    };
    const mockFetch = vi.fn(async (id: string) => {
      if (id === 'channel-1') {
        return mockChannel;
      }
      if (id === 'thread-1') {
        return mockThread;
      }
      return null;
    });
    const mockClient = {
      channels: {
        fetch: mockFetch
      }
    };

    const result = await manager.ensureReminderThread('channel-1', mockClient as any, 'thread-1', 'msg-1');

    expect(result.success).toBe(true);
    expect(mockParentMessage.edit).toHaveBeenCalled();
  });
});
