import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, MessageFlags } from 'discord.js';
import type { APIMessageTopLevelComponent } from 'discord.js';
import { InventoryMessageManager } from '../../src/services/InventoryMessageManager';
import type { InventoryItem } from '../../src/models/InventoryItem';

const mockMetadataManager = vi.hoisted(() => ({
  getChannelMetadata: vi.fn(),
  createChannelMetadata: vi.fn(),
  updateChannelMetadata: vi.fn()
}));

const mockRenderedComponents = vi.hoisted(() => ([
  {
    type: 17,
    components: [
      {
        type: 10,
        content: 'rendered'
      }
    ]
  }
] as APIMessageTopLevelComponent[]));

const mockInventoryFormatter = vi.hoisted(() => ({
  formatEmptyContent: vi.fn(),
  formatDataContent: vi.fn(),
  buildInventoryComponents: vi.fn()
}));

vi.mock('../../src/services/InventoryChannelStore', () => ({
  InventoryChannelStore: {
    getInstance: vi.fn(() => mockMetadataManager)
  }
}));

vi.mock('../../src/ui/InventoryFormatter', () => ({
  InventoryFormatter: mockInventoryFormatter
}));

describe('InventoryMessageManager', () => {
  const items: InventoryItem[] = [
    { id: 'item-1', name: '米', stock: '5', category: '食品' }
  ];

  const mockCreatedMessage = {
    id: 'created-message-id',
    edit: vi.fn()
  };

  const mockExistingMessage = {
    id: 'existing-message-id',
    edit: vi.fn()
  };

  const mockChannel = {
    id: 'channel-1',
    type: ChannelType.GuildText,
    isTextBased: (): boolean => true,
    send: vi.fn(),
    messages: {
      fetch: vi.fn()
    }
  };

  const mockClient = {
    channels: {
      fetch: vi.fn()
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.channels.fetch.mockResolvedValue(mockChannel);
    mockChannel.send.mockResolvedValue(mockCreatedMessage);
    mockChannel.messages.fetch.mockResolvedValue(mockExistingMessage);
    mockCreatedMessage.edit.mockResolvedValue(mockCreatedMessage);
    mockExistingMessage.edit.mockResolvedValue(mockExistingMessage);
    mockMetadataManager.getChannelMetadata.mockResolvedValue(null);
    mockMetadataManager.createChannelMetadata.mockResolvedValue({ success: true });
    mockMetadataManager.updateChannelMetadata.mockResolvedValue({ success: true });
    mockInventoryFormatter.formatEmptyContent.mockResolvedValue('empty content');
    mockInventoryFormatter.formatDataContent.mockResolvedValue('data content');
    mockInventoryFormatter.buildInventoryComponents.mockReturnValue(mockRenderedComponents);
  });

  it('redraws the stored title and patches only the display ID after concurrent settings changes', async () => {
    mockMetadataManager.getChannelMetadata.mockResolvedValue({ channelId: 'channel-1', messageId: 'existing-message-id', listTitle: '食品在庫', defaultCategory: '食品' });
    mockExistingMessage.edit.mockImplementation(async () => {
      // Another operation may change settings while Discord responds.
      mockMetadataManager.getChannelMetadata.mockResolvedValue({ channelId: 'channel-1', messageId: 'existing-message-id', listTitle: '新しい食品在庫', defaultCategory: '常温' });
      return mockExistingMessage;
    });
    await InventoryMessageManager.getInstance().createOrUpdateMessage('channel-1', items, '在庫リスト', mockClient as any);
    expect(mockInventoryFormatter.formatDataContent).toHaveBeenCalledWith(items, '食品在庫', 'channel-1', '食品');
    expect(mockMetadataManager.updateChannelMetadata).toHaveBeenCalledWith('channel-1', { messageId: 'existing-message-id' });
  });

  it('Given items are empty and no existing metadata When createOrUpdateMessage is called Then sends Components V2 message and creates metadata', async () => {
    // Given
    mockMetadataManager.getChannelMetadata.mockResolvedValue(null);

    // When
    const result = await InventoryMessageManager.getInstance().createOrUpdateMessage(
      'channel-1',
      [],
      '在庫リスト',
      mockClient as any
    );

    // Then
    expect(result.success).toBe(true);
    expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-1');
    expect(mockInventoryFormatter.formatEmptyContent).toHaveBeenCalledWith(
      '在庫リスト',
      'channel-1',
      undefined
    );
    expect(mockInventoryFormatter.formatDataContent).not.toHaveBeenCalled();
    expect(mockInventoryFormatter.buildInventoryComponents).toHaveBeenCalledWith('empty content');
    expect(mockChannel.send).toHaveBeenCalledWith({
      flags: MessageFlags.IsComponentsV2,
      components: mockRenderedComponents
    });
    expect(mockMetadataManager.createChannelMetadata).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        messageId: 'created-message-id'
      })
    );
  });

  it('Given items exist and metadata has a valid messageId When createOrUpdateMessage is called Then fetches and edits the existing Components V2 message', async () => {
    // Given
    mockMetadataManager.getChannelMetadata.mockResolvedValue({
      channelId: 'channel-1',
      messageId: 'existing-message-id',
      listTitle: '古い在庫リスト',
      lastSyncTime: new Date('2026-01-01T00:00:00.000Z'),
      defaultCategory: 'その他'
    });

    // When
    const result = await InventoryMessageManager.getInstance().createOrUpdateMessage(
      'channel-1',
      items,
      '在庫リスト',
      mockClient as any
    );

    // Then
    expect(result.success).toBe(true);
    expect(mockInventoryFormatter.formatDataContent).toHaveBeenCalledWith(
      items,
      '古い在庫リスト',
      'channel-1',
      'その他'
    );
    expect(mockInventoryFormatter.formatEmptyContent).not.toHaveBeenCalled();
    expect(mockInventoryFormatter.buildInventoryComponents).toHaveBeenCalledWith('data content');
    expect(mockChannel.messages.fetch).toHaveBeenCalledWith('existing-message-id');
    expect(mockExistingMessage.edit).toHaveBeenCalledWith({
      content: null,
      embeds: [],
      flags: MessageFlags.IsComponentsV2,
      components: mockRenderedComponents
    });
    expect(mockChannel.send).not.toHaveBeenCalled();
    expect(mockMetadataManager.updateChannelMetadata).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        messageId: 'existing-message-id'
      })
    );
  });

  it('Given existing metadata but fetch returns 404 When createOrUpdateMessage is called Then falls back to creating a new Components V2 message', async () => {
    // Given
    mockMetadataManager.getChannelMetadata.mockResolvedValue({
      channelId: 'channel-1',
      messageId: 'missing-message-id',
      listTitle: '在庫リスト',
      lastSyncTime: new Date('2026-01-01T00:00:00.000Z'),
      defaultCategory: 'その他'
    });
    mockChannel.messages.fetch.mockRejectedValue(Object.assign(new Error('Unknown Message'), { code: 10008 }));

    // When
    const result = await InventoryMessageManager.getInstance().createOrUpdateMessage(
      'channel-1',
      items,
      '在庫リスト',
      mockClient as any
    );

    // Then
    expect(result.success).toBe(true);
    expect(mockChannel.messages.fetch).toHaveBeenCalledWith('missing-message-id');
    expect(mockChannel.send).toHaveBeenCalledWith({
      flags: MessageFlags.IsComponentsV2,
      components: mockRenderedComponents
    });
    expect(mockMetadataManager.updateChannelMetadata).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        messageId: 'created-message-id'
      })
    );
  });

  it('Given existing message but edit fails When createOrUpdateMessage is called Then falls back to creating a new Components V2 message', async () => {
    // Given
    mockMetadataManager.getChannelMetadata.mockResolvedValue({
      channelId: 'channel-1',
      messageId: 'existing-message-id',
      listTitle: '在庫リスト',
      lastSyncTime: new Date('2026-01-01T00:00:00.000Z'),
      defaultCategory: 'その他'
    });
    mockExistingMessage.edit.mockRejectedValue(new Error('Edit failed'));

    // When
    const result = await InventoryMessageManager.getInstance().createOrUpdateMessage(
      'channel-1',
      items,
      '在庫リスト',
      mockClient as any
    );

    // Then
    expect(result.success).toBe(true);
    expect(mockChannel.messages.fetch).toHaveBeenCalledWith('existing-message-id');
    expect(mockExistingMessage.edit).toHaveBeenCalledWith({
      content: null,
      embeds: [],
      flags: MessageFlags.IsComponentsV2,
      components: mockRenderedComponents
    });
    expect(mockChannel.send).toHaveBeenCalledWith({
      flags: MessageFlags.IsComponentsV2,
      components: mockRenderedComponents
    });
    expect(mockMetadataManager.updateChannelMetadata).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        messageId: 'created-message-id'
      })
    );
  });
});
