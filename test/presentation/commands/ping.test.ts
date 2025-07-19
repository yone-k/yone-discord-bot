import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PingCommand } from '../../../src/presentation/commands/PingCommand';
import { PingUseCase } from '../../../src/application/usecases/PingUseCase';
import { DiscordClient } from '../../../src/infrastructure/discord/DiscordClient';

describe('PingCommand', () => {
  let pingCommand: PingCommand;
  let mockInteraction: any;
  let mockPingUseCase: PingUseCase;
  let mockDiscordClient: DiscordClient;

  beforeEach(() => {
    // Discord.js interaction のモック作成
    mockInteraction = {
      reply: vi.fn(),
      deferReply: vi.fn(),
      editReply: vi.fn(),
      user: { id: 'test-user-id' },
      guild: { id: 'test-guild-id' },
      createdTimestamp: Date.now(),
    };

    // PingUseCase のモック作成
    mockPingUseCase = {
      execute: vi.fn()
    } as any;

    // DiscordClient のモック作成
    mockDiscordClient = {
      replyToInteraction: vi.fn()
    } as any;

    pingCommand = new PingCommand(mockPingUseCase, mockDiscordClient);
  });

  describe('execute', () => {
    it('should respond with "Pong!" message', async () => {
      // Arrange
      vi.mocked(mockPingUseCase.execute).mockResolvedValue({
        message: 'Pong! 5ms',
        responseTime: 5
      });

      // Act
      await pingCommand.execute(mockInteraction);

      // Assert
      expect(mockPingUseCase.execute).toHaveBeenCalledTimes(1);
      expect(mockDiscordClient.replyToInteraction).toHaveBeenCalledWith(
        mockInteraction,
        expect.objectContaining({
          content: expect.stringContaining('Pong!'),
          ephemeral: false
        })
      );
    });

    it('should include response time in the reply', async () => {
      // Arrange
      vi.mocked(mockPingUseCase.execute).mockResolvedValue({
        message: 'Pong! 3ms',
        responseTime: 3
      });

      // Act
      await pingCommand.execute(mockInteraction);

      // Assert
      expect(mockDiscordClient.replyToInteraction).toHaveBeenCalledWith(
        mockInteraction,
        expect.objectContaining({
          content: expect.stringMatching(/\d+ms/),
          ephemeral: false
        })
      );
    });

    it('should handle Discord.js interaction format correctly', async () => {
      // Arrange
      vi.mocked(mockPingUseCase.execute).mockResolvedValue({
        message: 'Pong! 7ms',
        responseTime: 7
      });

      // Act
      await pingCommand.execute(mockInteraction);

      // Assert
      expect(mockPingUseCase.execute).toHaveBeenCalledTimes(1);
      expect(mockDiscordClient.replyToInteraction).toHaveBeenCalledTimes(1);
      expect(mockDiscordClient.replyToInteraction).toHaveBeenCalledWith(
        mockInteraction,
        expect.objectContaining({
          content: expect.any(String),
          ephemeral: false,
        })
      );
    });

    it('should calculate and display accurate response time', async () => {
      // Arrange
      vi.mocked(mockPingUseCase.execute).mockResolvedValue({
        message: 'Pong! 12ms',
        responseTime: 12
      });
      
      // Act
      await pingCommand.execute(mockInteraction);
      
      // Assert
      expect(mockDiscordClient.replyToInteraction).toHaveBeenCalledWith(
        mockInteraction,
        expect.objectContaining({
          content: 'Pong! 12ms',
          ephemeral: false
        })
      );
      
      // メッセージから応答時間を抽出して検証
      const callArgs = vi.mocked(mockDiscordClient.replyToInteraction).mock.calls[0][1];
      const responseContent = callArgs.content;
      const responseTimeMatch = responseContent.match(/(\d+)ms/);
      
      expect(responseTimeMatch).toBeTruthy();
      if (responseTimeMatch) {
        const responseTime = parseInt(responseTimeMatch[1]);
        expect(responseTime).toBeGreaterThanOrEqual(0);
        expect(responseTime).toBeLessThan(1000); // 1秒以内
      }
    });
  });

  describe('command data', () => {
    it('should have correct command name', () => {
      const commandData = pingCommand.data;
      expect(commandData.name).toBe('ping');
    });

    it('should have appropriate description', () => {
      const commandData = pingCommand.data;
      expect(commandData.description).toBe('Replies with Pong!');
    });
  });
});