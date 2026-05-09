import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemindTaskCompleteModalHandler } from '../../src/modals/RemindTaskCompleteModalHandler';
import { createRemindTask, type RemindInventoryItem, type RemindTask } from '../../src/models/RemindTask';
import type { InventoryItem } from '../../src/models/InventoryItem';
import { Logger } from '../../src/utils/logger';

const taskChannelId = 'task-channel-1';
const linkedInventoryChannelId = 'inventory-channel-1';
const messageId = 'message-1';
const now = new Date('2026-01-05T10:00:00+09:00');

const baseTaskInput = {
  id: 'task-1',
  messageId,
  title: '掃除',
  intervalDays: 7,
  timeOfDay: '09:00',
  remindBeforeMinutes: 60,
  startAt: new Date('2025-12-29T09:00:00+09:00'),
  nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
  createdAt: new Date('2025-12-29T09:00:00+09:00'),
  updatedAt: new Date('2025-12-29T09:00:00+09:00')
};

const createTask = (
  inventoryItems: RemindInventoryItem[],
  overrides: Partial<Parameters<typeof createRemindTask>[0]> = {}
): RemindTask => createRemindTask({
  ...baseTaskInput,
  inventoryItems,
  ...overrides
});

const createInventoryItem = (id: string, name: string): InventoryItem => ({
  id,
  name,
  stock: 10,
  category: ''
});

const createInteraction = (input: string) => ({
  customId: `remind-task-complete-modal:${messageId}`,
  user: { id: 'user-1' },
  guild: { id: 'guild-1' },
  guildId: 'guild-1',
  channelId: taskChannelId,
  client: {} as unknown,
  fields: {
    getTextInputValue: vi.fn().mockReturnValue(input)
  },
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  deleteReply: vi.fn().mockResolvedValue(undefined)
});

function createSubject(options: {
  task: RemindTask;
  input?: string;
  linkedInventoryChannelId?: string;
  inventoryItemsById?: Record<string, InventoryItem | null>;
  consumeResult?: unknown;
  inventoryRepositoryItems?: InventoryItem[];
}) {
  const linkedChannelId = Object.prototype.hasOwnProperty.call(options, 'linkedInventoryChannelId')
    ? options.linkedInventoryChannelId
    : linkedInventoryChannelId;
  const consumeResult = options.consumeResult ?? {
    kind: 'success',
    linkedInventoryChannelId: linkedChannelId
  };
  const mockRepository = {
    findTaskByMessageId: vi.fn().mockResolvedValue(options.task),
    updateTask: vi.fn().mockResolvedValue({ success: true })
  };
  const mockMessageManager = {
    updateTaskMessage: vi.fn().mockResolvedValue({ success: true }),
    sendReminderToThread: vi.fn().mockResolvedValue({ success: true })
  };
  const mockMetadataManager = {
    getChannelMetadata: vi.fn().mockResolvedValue({
      success: true,
      metadata: { linkedInventoryChannelId: linkedChannelId }
    })
  };
  const mockInventoryService = {
    consumeForTask: vi.fn().mockResolvedValue(consumeResult),
    getById: vi.fn().mockImplementation(async (_channelId: string, inventoryId: string) => {
      if (Object.prototype.hasOwnProperty.call(options.inventoryItemsById ?? {}, inventoryId)) {
        return options.inventoryItemsById?.[inventoryId] ?? null;
      }
      return null;
    })
  };
  const mockInventoryRepository = {
    fetchAll: vi.fn().mockResolvedValue(options.inventoryRepositoryItems ?? [])
  };
  const mockInventoryMessageManager = {
    createOrUpdateMessage: vi.fn().mockResolvedValue({ success: true })
  };
  const mockRefreshService = {
    refreshTasksUsingInventory: vi.fn().mockResolvedValue(undefined)
  };
  const handler = new RemindTaskCompleteModalHandler(
    new Logger(),
    undefined,
    mockMetadataManager as never,
    mockRepository as never,
    mockMessageManager as never,
    mockInventoryService as never,
    mockInventoryRepository,
    mockInventoryMessageManager,
    mockRefreshService
  );
  const interaction = createInteraction(options.input ?? '');

  return {
    handler,
    interaction,
    mockRepository,
    mockMessageManager,
    mockMetadataManager,
    mockInventoryService,
    mockInventoryRepository,
    mockInventoryMessageManager,
    mockRefreshService
  };
}

describe('RemindTaskCompleteModalHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fixed のみのタスクで入力どおりに消費する（fixed上書き）', async () => {
    const task = createTask([{ inventoryId: 'A-id', consume: 1 }]);
    const { handler, interaction, mockInventoryService } = createSubject({
      task,
      input: 'A,3',
      inventoryItemsById: {
        'A-id': createInventoryItem('A-id', 'A')
      }
    });

    await handler.handle({ interaction } as never);

    expect(interaction.fields.getTextInputValue).toHaveBeenCalledWith('inventory-items');
    expect(mockInventoryService.getById).toHaveBeenCalledWith(linkedInventoryChannelId, 'A-id');
    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'A-id', consume: 3 }]
      })
    );
  });

  it('fixed のみのタスクで入力空欄/0 → 元の consume で消費', async () => {
    const task = createTask([{ inventoryId: 'A-id', consume: 2 }]);
    const { handler, interaction, mockInventoryService } = createSubject({
      task,
      input: 'A,',
      inventoryItemsById: {
        'A-id': createInventoryItem('A-id', 'A')
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'A-id', consume: 2 }]
      })
    );
  });

  it('variable のみのタスクで入力値で消費、空欄/0はスキップ', async () => {
    const consumedTask = createTask([{ inventoryId: 'A-id', consume: 0 }]);
    const consumed = createSubject({
      task: consumedTask,
      input: 'A,5',
      inventoryItemsById: {
        'A-id': createInventoryItem('A-id', 'A')
      }
    });

    await consumed.handler.handle({ interaction: consumed.interaction } as never);

    expect(consumed.mockInventoryService.consumeForTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'A-id', consume: 5 }]
      })
    );

    const skippedTask = createTask([{ inventoryId: 'A-id', consume: 0 }]);
    const skipped = createSubject({
      task: skippedTask,
      input: 'A,',
      inventoryItemsById: {
        'A-id': createInventoryItem('A-id', 'A')
      }
    });

    await skipped.handler.handle({ interaction: skipped.interaction } as never);

    expect(skipped.mockInventoryService.consumeForTask).not.toHaveBeenCalled();
    expect(skipped.mockRepository.updateTask).toHaveBeenCalled();
  });

  it('fixed + variable 混在で variable空欄→fixedだけ消費', async () => {
    const task = createTask([
      { inventoryId: 'fixedA-id', consume: 1 },
      { inventoryId: 'variableB-id', consume: 0 }
    ]);
    const { handler, interaction, mockInventoryService } = createSubject({
      task,
      input: 'fixedA,2\nvariableB,',
      inventoryItemsById: {
        'fixedA-id': createInventoryItem('fixedA-id', 'fixedA'),
        'variableB-id': createInventoryItem('variableB-id', 'variableB')
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'fixedA-id', consume: 2 }]
      })
    );
  });

  it('すべて variable で全行空欄 → consumeForTask は呼ばれず、タスクの nextDueAt だけ更新', async () => {
    const task = createTask([
      { inventoryId: 'A-id', consume: 0 },
      { inventoryId: 'B-id', consume: 0 }
    ]);
    const {
      handler,
      interaction,
      mockRepository,
      mockInventoryService,
      mockInventoryRepository,
      mockInventoryMessageManager,
      mockRefreshService,
      mockMessageManager
    } = createSubject({
      task,
      input: 'A,\nB,0',
      inventoryItemsById: {
        'A-id': createInventoryItem('A-id', 'A'),
        'B-id': createInventoryItem('B-id', 'B')
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockInventoryService.consumeForTask).not.toHaveBeenCalled();
    expect(mockRepository.updateTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: task.inventoryItems,
        nextDueAt: new Date('2026-01-12T09:00:00+09:00')
      })
    );
    expect(mockInventoryRepository.fetchAll).not.toHaveBeenCalled();
    expect(mockInventoryMessageManager.createOrUpdateMessage).not.toHaveBeenCalled();
    expect(mockRefreshService.refreshTasksUsingInventory).not.toHaveBeenCalled();
    expect(mockMessageManager.sendReminderToThread).not.toHaveBeenCalled();
  });

  it('在庫不足時、shortage 結果でエラーメッセージを返し、タスクは更新されない', async () => {
    const task = createTask([{ inventoryId: 'A-id', consume: 1 }]);
    const { handler, interaction, mockInventoryService, mockRepository, mockMessageManager } = createSubject({
      task,
      input: 'A,4',
      inventoryItemsById: {
        'A-id': createInventoryItem('A-id', 'A')
      },
      consumeResult: {
        kind: 'shortage',
        items: [{ inventoryId: 'A-id', name: 'A', required: 4, available: 1 }]
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'A-id', consume: 4 }]
      })
    );
    expect(mockRepository.updateTask).not.toHaveBeenCalled();
    expect(mockMessageManager.updateTaskMessage).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('不足している在庫の詳細は以下の通りです')
    }));
  });

  it('入力フォーマット不正時、parseCompletionInput のエラーメッセージを返す', async () => {
    const task = createTask([{ inventoryId: 'A-id', consume: 1 }]);
    const { handler, interaction, mockInventoryService, mockRepository } = createSubject({
      task,
      input: 'A,1,2,3',
      inventoryItemsById: {
        'A-id': createInventoryItem('A-id', 'A')
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockInventoryService.consumeForTask).not.toHaveBeenCalled();
    expect(mockRepository.updateTask).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: '完了入力の形式が不正です'
    }));
  });

  it('linkedInventoryChannelId が未設定の場合、エラーメッセージで返す', async () => {
    const task = createTask([{ inventoryId: 'A-id', consume: 1 }]);
    const { handler, interaction, mockMetadataManager, mockInventoryService, mockRepository } = createSubject({
      task,
      input: 'A,1',
      linkedInventoryChannelId: undefined
    });

    await handler.handle({ interaction } as never);

    expect(mockMetadataManager.getChannelMetadata).toHaveBeenCalledWith(taskChannelId);
    expect(mockInventoryService.consumeForTask).not.toHaveBeenCalled();
    expect(mockRepository.updateTask).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: '在庫チャンネルが連携されていません'
    }));
  });

  it('タスクに存在しないアイテム名の行は無視される', async () => {
    const task = createTask([{ inventoryId: 'real-id', consume: 1 }]);
    const { handler, interaction, mockInventoryService } = createSubject({
      task,
      input: '存在しないアイテム,3\n本物アイテム,1',
      inventoryItemsById: {
        'real-id': createInventoryItem('real-id', '本物アイテム')
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'real-id', consume: 1 }]
      })
    );
  });

  it('シート保存時の inventoryItems は元の consume === 0 を維持している', async () => {
    const originalInventoryItems = [{ inventoryId: 'variable-id', consume: 0 }];
    const task = createTask(originalInventoryItems);
    const { handler, interaction, mockRepository, mockInventoryService } = createSubject({
      task,
      input: 'Variable,6',
      inventoryItemsById: {
        'variable-id': createInventoryItem('variable-id', 'Variable')
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'variable-id', consume: 6 }]
      })
    );
    expect(mockRepository.updateTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: originalInventoryItems
      })
    );
  });

  it('タスクの nextDueAt/lastDoneAt/overdueNotifyCount などは既存と同じく更新される', async () => {
    const task = createTask(
      [{ inventoryId: 'A-id', consume: 1 }],
      {
        lastRemindDueAt: new Date('2026-01-05T09:00:00+09:00'),
        overdueNotifyCount: 3,
        lastOverdueNotifiedAt: new Date('2026-01-05T09:30:00+09:00')
      }
    );
    const { handler, interaction, mockRepository, mockMessageManager } = createSubject({
      task,
      input: 'A,1',
      inventoryItemsById: {
        'A-id': createInventoryItem('A-id', 'A')
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockRepository.updateTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        lastDoneAt: now,
        nextDueAt: new Date('2026-01-12T09:00:00+09:00'),
        lastRemindDueAt: null,
        overdueNotifyCount: 0,
        lastOverdueNotifiedAt: null,
        updatedAt: now
      })
    );
    expect(mockMessageManager.updateTaskMessage).toHaveBeenCalledWith(
      taskChannelId,
      messageId,
      expect.objectContaining({
        lastDoneAt: now,
        nextDueAt: new Date('2026-01-12T09:00:00+09:00')
      }),
      interaction.client,
      now
    );
  });

  it('consumeForTask に渡される tempTask.inventoryItems は effectiveConsume > 0 のものだけ含む', async () => {
    const task = createTask([
      { inventoryId: 'fixedA-id', consume: 1 },
      { inventoryId: 'variableB-id', consume: 0 },
      { inventoryId: 'fixedC-id', consume: 2 }
    ]);
    const { handler, interaction, mockInventoryService } = createSubject({
      task,
      input: 'fixedA,0\nvariableB,0\nfixedC,4',
      inventoryItemsById: {
        'fixedA-id': createInventoryItem('fixedA-id', 'fixedA'),
        'variableB-id': createInventoryItem('variableB-id', 'variableB'),
        'fixedC-id': createInventoryItem('fixedC-id', 'fixedC')
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: [
          { inventoryId: 'fixedA-id', consume: 1 },
          { inventoryId: 'fixedC-id', consume: 4 }
        ]
      })
    );
  });

  it('fixedアイテムの inventoryService.getById が null を返す場合、tempTask に元の {inventoryId, consume} を含めて consumeForTask に渡し、shortage 結果でエラー応答する', async () => {
    const task = createTask([{ inventoryId: 'missing-fixed-id', consume: 2 }]);
    const { handler, interaction, mockInventoryService, mockRepository } = createSubject({
      task,
      input: 'A,5',
      inventoryItemsById: {
        'missing-fixed-id': null
      },
      consumeResult: {
        kind: 'shortage',
        items: [{ inventoryId: 'missing-fixed-id', name: 'missing-fixed-id', required: 2, available: 0 }]
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockInventoryService.getById).toHaveBeenCalledWith(linkedInventoryChannelId, 'missing-fixed-id');
    expect(mockInventoryService.consumeForTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: [{ inventoryId: 'missing-fixed-id', consume: 2 }]
      })
    );
    expect(mockRepository.updateTask).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('不足している在庫の詳細は以下の通りです')
    }));
  });

  it('variableアイテムの inventoryService.getById が null を返す場合、消費スキップしてタスク完了は成功する', async () => {
    const task = createTask([{ inventoryId: 'missing-variable-id', consume: 0 }]);
    const { handler, interaction, mockInventoryService, mockRepository, mockInventoryRepository } = createSubject({
      task,
      input: 'Variable,5',
      inventoryItemsById: {
        'missing-variable-id': null
      }
    });

    await handler.handle({ interaction } as never);

    expect(mockInventoryService.getById).toHaveBeenCalledWith(linkedInventoryChannelId, 'missing-variable-id');
    expect(mockInventoryService.consumeForTask).not.toHaveBeenCalled();
    expect(mockRepository.updateTask).toHaveBeenCalledWith(
      taskChannelId,
      expect.objectContaining({
        inventoryItems: task.inventoryItems,
        lastDoneAt: now
      })
    );
    expect(mockInventoryRepository.fetchAll).not.toHaveBeenCalled();
    expect(interaction.deleteReply).toHaveBeenCalled();
  });
});
