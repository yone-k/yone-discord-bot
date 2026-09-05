import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageManager } from '../../src/services/MessageManager';
import { EmbedBuilder, ChannelType, ComponentType, MessageFlags } from 'discord.js';

// Discord.jsのモック
const mockClient = {
  channels: {
    fetch: vi.fn()
  }
};

const mockChannel = {
  id: 'test-channel-123',
  type: ChannelType.GuildText,
  send: vi.fn(),
  messages: {
    fetch: vi.fn()
  }
};

const mockMessage = {
  id: 'test-message-456',
  pinned: false,
  pin: vi.fn(),
  unpin: vi.fn(),
  edit: vi.fn(),
  startThread: vi.fn()
};

// モックのモジュール
vi.mock('../../src/services/ListChannelStore', () => ({
  ListChannelStore: {
    getInstance: vi.fn().mockReturnValue({
      getChannelMetadata: vi.fn().mockResolvedValue({ success: false }),
      createChannelMetadata: vi.fn().mockResolvedValue({ success: true }),
      updateChannelMetadata: vi.fn().mockResolvedValue({ success: true })
    })
  }
}));

vi.mock('../../src/services/ButtonConfigManager', () => ({
  ButtonConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      isButtonEnabled: vi.fn().mockReturnValue(false),
      getCommandButtons: vi.fn().mockReturnValue([])
    })
  }
}));

describe('MessageManager', () => {
  let messageManager: MessageManager;
  let testEmbed: EmbedBuilder;

  beforeEach(() => {
    messageManager = new MessageManager();
    testEmbed = new EmbedBuilder()
      .setTitle('テストリスト')
      .setDescription('テスト用のembedです');
    
    vi.clearAllMocks();
    
    // デフォルトのモック設定
    mockClient.channels.fetch.mockResolvedValue(mockChannel);
    mockChannel.send.mockResolvedValue(mockMessage);
    mockChannel.messages.fetch.mockResolvedValue(mockMessage);
    mockMessage.pin.mockResolvedValue(undefined);
    mockMessage.unpin.mockResolvedValue(undefined);
    mockMessage.edit.mockResolvedValue(mockMessage);
    mockMessage.startThread.mockResolvedValue(null);
    mockMessage.pinned = false;
  });

  describe('ensureMessagePinned', () => {
    it('メッセージがピン留めされていない場合はピン留めする', async () => {
      // Arrange
      mockMessage.pinned = false;

      // Act
      const result = await messageManager.ensureMessagePinned(
        'test-channel-123',
        'test-message-456',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockMessage.pin).toHaveBeenCalled();
    });

    it('メッセージが既にピン留めされている場合は何もしない', async () => {
      // Arrange
      mockMessage.pinned = true;

      // Act
      const result = await messageManager.ensureMessagePinned(
        'test-channel-123',
        'test-message-456',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockMessage.pin).not.toHaveBeenCalled();
    });

    it('メッセージが見つからない場合はエラーを返す', async () => {
      // Arrange
      mockChannel.messages.fetch.mockRejectedValue(new Error('Unknown Message'));

      // Act
      const result = await messageManager.ensureMessagePinned(
        'test-channel-123',
        'non-existent-message',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('メッセージが見つかりません');
    });

    it('チャンネルが見つからない場合はエラーを返す', async () => {
      // Arrange
      mockClient.channels.fetch.mockResolvedValue(null);

      // Act
      const result = await messageManager.ensureMessagePinned(
        'non-existent-channel',
        'test-message-456',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('チャンネルが見つかりません');
    });

    it('ピン留め処理でエラーが発生した場合はエラーを返す', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.pin.mockRejectedValue(new Error('Pin failed'));

      // Act
      const result = await messageManager.ensureMessagePinned(
        'test-channel-123',
        'test-message-456',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Failed to pin message');
    });
  });

  describe('createOrUpdateMessageWithMetadata (with pinning)', () => {
    it('新規メッセージを作成してピン留めする', async () => {
      // Arrange
      mockMessage.pinned = false;

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();
      expect(mockMessage.pin).toHaveBeenCalled();
    });

    it('メッセージ作成後のピン留めが失敗してもメッセージ作成は成功とする', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.pin.mockRejectedValue(new Error('Pin failed'));

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();
      expect(mockMessage.pin).toHaveBeenCalled();
    });
  });

  describe('createOrUpdateMessageWithMetadata (with operationLogThreadId)', () => {
    it('operationLogThreadIdパラメータを受け取れる', async () => {
      // Arrange
      mockMessage.pinned = false;
      const operationLogThreadId = 'operation-thread-123';

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        operationLogThreadId
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();
    });

    it('operationLogThreadIdがメタデータに保存される', async () => {
      // Arrange
      mockMessage.pinned = false;
      const operationLogThreadId = 'operation-thread-456';
      const mockListChannelStore = messageManager['metadataManager'];

      // Act
      await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        operationLogThreadId
      );

      // Assert
      expect(mockListChannelStore.createChannelMetadata).toHaveBeenCalledWith(
        'test-channel-123',
        expect.objectContaining({
          operationLogThreadId: 'operation-thread-456'
        })
      );
    });

    it('operationLogThreadIdが省略された場合は正常に動作する', async () => {
      // Arrange
      mockMessage.pinned = false;

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockChannel.send).toHaveBeenCalled();
    });

    it('描画引数が異なっても既存ログ設定を書き換えない', async () => {
      // Arrange
      mockMessage.pinned = false;
      const operationLogThreadId = 'operation-thread-789';
      const existingMetadata = {
        channelId: 'test-channel-123',
        messageId: 'old-message-id',
        listTitle: '古いタイトル',
        lastSyncTime: new Date(),
        defaultCategory: 'テスト',
        operationLogThreadId: 'old-thread-id'
      };
      
      const mockListChannelStore = messageManager['metadataManager'];
      mockListChannelStore.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: existingMetadata
      });

      // Act
      await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        operationLogThreadId
      );

      // Assert
      expect(mockListChannelStore.updateChannelMetadata).toHaveBeenCalledWith(
        'test-channel-123',
        { messageId: 'test-message-456' }
      );
    });

    it('描画引数の空文字列で既存ログ設定を削除しない', async () => {
      // Arrange
      mockMessage.pinned = false;
      const operationLogThreadId = ''; // 空文字列で削除指示
      const existingMetadata = {
        channelId: 'test-channel-123',
        messageId: 'old-message-id',
        listTitle: '古いタイトル',
        lastSyncTime: new Date(),
        defaultCategory: 'テスト',
        operationLogThreadId: 'existing-thread-id'
      };
      
      const mockListChannelStore = messageManager['metadataManager'];
      mockListChannelStore.getChannelMetadata.mockResolvedValue({
        success: true,
        metadata: existingMetadata
      });

      // Act
      await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        operationLogThreadId
      );

      // Assert
      expect(mockListChannelStore.updateChannelMetadata).toHaveBeenCalledWith(
        'test-channel-123',
        { messageId: 'test-message-456' }
      );
    });

    it('新規作成時にoperationLogThreadIdが空文字列の場合、フィールドを追加しない', async () => {
      // Arrange
      mockMessage.pinned = false;
      const operationLogThreadId = ''; // 空文字列
      
      const mockListChannelStore = messageManager['metadataManager'];
      mockListChannelStore.getChannelMetadata.mockResolvedValue({
        success: false,
        metadata: null
      });

      // Act
      await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        operationLogThreadId
      );

      // Assert
      expect(mockListChannelStore.createChannelMetadata).toHaveBeenCalledWith(
        'test-channel-123',
        expect.not.objectContaining({
          operationLogThreadId: expect.anything()
        })
      );
    });
  });

  describe('createOrUpdateMessageWithMetadataV2', () => {
    it('V2メッセージを作成してピン留めする', async () => {
      const components = [{
        type: ComponentType.Container,
        components: [{
          type: ComponentType.TextDisplay,
          content: 'テスト'
        }]
      }];

      const result = await messageManager.createOrUpdateMessageWithMetadataV2(
        'test-channel-123',
        components,
        'テストリスト',
        mockClient as any
      );

      expect(result.success).toBe(true);
      expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({
        flags: MessageFlags.IsComponentsV2,
        components
      }));
      expect(mockMessage.pin).toHaveBeenCalled();
    });
  });

  describe('スレッド作成統合', () => {
    let mockThreadChannel: any;

    beforeEach(() => {
      mockThreadChannel = {
        id: 'thread-123',
        name: 'Operation Log',
        type: ChannelType.PublicThread,
        send: vi.fn()
      };
    });

    it('メッセージ作成後にスレッドが作成される', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.startThread = vi.fn().mockResolvedValue(mockThreadChannel);

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        undefined, // operationLogThreadId
        true // createOperationLogThread
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockMessage.startThread).toHaveBeenCalledWith({
        name: '操作ログ',
        autoArchiveDuration: 1440 // 24時間
      });
    });

    it('スレッド作成後にスレッドIDがメタデータに保存される', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.startThread = vi.fn().mockResolvedValue(mockThreadChannel);
      const mockListChannelStore = messageManager['metadataManager'];

      // Act
      await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        undefined, // operationLogThreadId
        true // createOperationLogThread
      );

      // Assert
      expect(mockListChannelStore.createChannelMetadata).toHaveBeenCalledWith(
        'test-channel-123',
        expect.objectContaining({
          operationLogThreadId: 'thread-123'
        })
      );
    });

    it('スレッド作成が失敗してもメッセージ作成は成功とする', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.startThread = vi.fn().mockRejectedValue(new Error('Thread creation failed'));

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        undefined, // operationLogThreadId
        true // createOperationLogThread
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockMessage.startThread).toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalled();
    });

    it('createOperationLogThreadがfalseの場合はスレッドを作成しない', async () => {
      // Arrange
      mockMessage.pinned = false;
      mockMessage.startThread = vi.fn();

      // Act
      const result = await messageManager.createOrUpdateMessageWithMetadata(
        'test-channel-123',
        testEmbed,
        'テストリスト',
        mockClient as any,
        undefined, // commandName
        undefined, // defaultCategory
        undefined, // operationLogThreadId
        false // createOperationLogThread
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockMessage.startThread).not.toHaveBeenCalled();
    });
  });
});

describe('DB描画結果とチャンネル直列化', () => {
  function fixture(): {manager:MessageManager;metadata:any;client:any;message:any} {
    const metadata = {getChannelMetadata:vi.fn().mockResolvedValue({success:true,metadata:{channelId:'1',messageId:'9',listTitle:'新タイトル',defaultCategory:'食品',operationLogThreadId:'8'}}),updateChannelMetadata:vi.fn().mockResolvedValue({success:true})};
    const message:any = {id:'9',pinned:true,edit:vi.fn()};
    message.edit.mockResolvedValue(message);
    const client = {channels:{fetch:vi.fn().mockResolvedValue({type:ChannelType.GuildText,messages:{fetch:vi.fn().mockResolvedValue(message)},send:vi.fn().mockResolvedValue(message)})}};
    return {manager:new MessageManager(metadata),metadata,client,message};
  }
  it('古い描画値で最新業務設定を書き戻さずIDのみ保存する',async()=>{
    const {manager,metadata,client}=fixture();
    await manager.createOrUpdateMessageWithMetadataV2('1',[],'旧タイトル',client,'list','旧カテゴリ','旧スレッド');
    expect(metadata.updateChannelMetadata).toHaveBeenCalledWith('1',{messageId:'9'});
  });
  it.each(['v2','embed'])('DB保存失敗を公開%sメソッドで失敗結果にする',async format=>{
    const {manager,metadata,client}=fixture();metadata.updateChannelMetadata.mockRejectedValue(new Error('DB write failed'));
    const result=format==='v2'?await manager.createOrUpdateMessageWithMetadataV2('1',[],'新タイトル',client):await manager.createOrUpdateMessageWithMetadata('1',new EmbedBuilder(), '新タイトル',client);
    expect(result.success).toBe(false);expect(result.errorMessage).toContain('DB write failed');
  });
  it('別インスタンスを含む3操作を受付順に直列化する',async()=>{
    const {manager,metadata,client,message}=fixture();const other=new MessageManager(metadata);
    let releaseFirst!:()=>void, releaseSecond!:()=>void;
    const firstGate=new Promise<void>(resolve=>{releaseFirst=resolve;});const secondGate=new Promise<void>(resolve=>{releaseSecond=resolve;});
    let active=0,maxActive=0,starts=0;
    message.edit.mockImplementation(async()=>{const index=starts++;active++;maxActive=Math.max(maxActive,active);if(index===0)await firstGate;if(index===1)await secondGate;active--;return message;});
    const first=manager.createOrUpdateMessageWithMetadataV2('1',[],'A',client);
    const second=manager.createOrUpdateMessageWithMetadataV2('1',[],'B',client);
    const third=other.createOrUpdateMessageWithMetadataV2('1',[],'C',client);
    await new Promise(resolve=>setImmediate(resolve));
    const startsBeforeFirst=starts;releaseFirst();await first;await new Promise(resolve=>setImmediate(resolve));
    const startsBeforeSecond=starts;releaseSecond();await Promise.all([second,third]);
    expect(startsBeforeFirst).toBe(1);expect(startsBeforeSecond).toBe(2);expect(maxActive).toBe(1);expect(starts).toBe(3);
  });
});
