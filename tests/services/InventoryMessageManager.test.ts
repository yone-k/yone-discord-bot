import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { InventoryMessageManager } from '../../src/services/InventoryMessageManager';
import type { InventoryItem } from '../../src/models/InventoryItem';

const mockMetadataManager = vi.hoisted(() => ({
  getChannelMetadata: vi.fn(),
  createChannelMetadata: vi.fn(),
  updateChannelMetadata: vi.fn()
}));

const mockFormattedMessage = vi.hoisted(() => ({
  embeds: [{ data: { title: '在庫リスト', description: 'formatted inventory' } }],
  components: [{ data: { type: 1 }, components: [] }]
}));

vi.mock('../../src/services/InventoryMetadataManager', () => ({
  InventoryMetadataManager: {
    getInstance: vi.fn(() => mockMetadataManager)
  }
}));

vi.mock('../../src/ui/InventoryFormatter', () => ({
  InventoryFormatter: {
    formatInventoryMessage: vi.fn(() => mockFormattedMessage)
  }
}));

describe('InventoryMessageManager', () => {
  const items: InventoryItem[] = [
    { id: 'item-1', name: '米', stock: 5, category: '食品' }
  ];

  const mockCreatedMessage = {
    id: 'created-message-id',
    pin: vi.fn(),
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
    mockCreatedMessage.pin.mockResolvedValue(undefined);
    mockCreatedMessage.edit.mockResolvedValue(mockCreatedMessage);
    mockExistingMessage.edit.mockResolvedValue(mockExistingMessage);
    mockMetadataManager.getChannelMetadata.mockResolvedValue(null);
    mockMetadataManager.createChannelMetadata.mockResolvedValue({ success: true });
    mockMetadataManager.updateChannelMetadata.mockResolvedValue({ success: true });
  });

  it('Given no existing message When createOrUpdateMessage is called Then sends new message and creates metadata', async () => {
    // Given
    mockMetadataManager.getChannelMetadata.mockResolvedValue(null);

    // When
    const result = await InventoryMessageManager.getInstance().createOrUpdateMessage(
      'channel-1',
      items,
      '在庫リスト',
      mockClient as any
    );

    // Then
    expect(result.success).toBe(true);
    expect(mockClient.channels.fetch).toHaveBeenCalledWith('channel-1');
    expect(mockChannel.send).toHaveBeenCalledWith({
      embeds: mockFormattedMessage.embeds,
      components: mockFormattedMessage.components
    });
    expect(mockMetadataManager.createChannelMetadata).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        messageId: 'created-message-id',
        listTitle: '在庫リスト'
      })
    );
  });

  it('Given existing message When createOrUpdateMessage is called Then fetches and edits the existing message', async () => {
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
    expect(mockChannel.messages.fetch).toHaveBeenCalledWith('existing-message-id');
    expect(mockExistingMessage.edit).toHaveBeenCalledWith({
      embeds: mockFormattedMessage.embeds,
      components: mockFormattedMessage.components
    });
    expect(mockChannel.send).not.toHaveBeenCalled();
    expect(mockMetadataManager.updateChannelMetadata).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        messageId: 'existing-message-id',
        listTitle: '在庫リスト'
      })
    );
  });

  it('Given existing metadata but fetch returns 404 When createOrUpdateMessage is called Then falls back to creating a new message', async () => {
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
      embeds: mockFormattedMessage.embeds,
      components: mockFormattedMessage.components
    });
    expect(mockMetadataManager.updateChannelMetadata).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        messageId: 'created-message-id',
        listTitle: '在庫リスト'
      })
    );
  });

  it('Given existing message but edit fails When createOrUpdateMessage is called Then falls back to creating a new message', async () => {
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
      embeds: mockFormattedMessage.embeds,
      components: mockFormattedMessage.components
    });
    expect(mockChannel.send).toHaveBeenCalledWith({
      embeds: mockFormattedMessage.embeds,
      components: mockFormattedMessage.components
    });
    expect(mockMetadataManager.updateChannelMetadata).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        messageId: 'created-message-id',
        listTitle: '在庫リスト'
      })
    );
  });
});
