import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import { CommandAutoDiscovery } from '../../src/scripts/CommandAutoDiscovery';
import { Logger, LogLevel } from '../../src/utils/logger';
import { BaseCommand } from '../../src/base/BaseCommand';

class MockCommand extends BaseCommand {
  constructor(name: string, description: string, logger: Logger) {
    super(name, description, logger);
  }

  async execute(): Promise<void> {
    this.logger.info(`Mock command ${this.name} executed`);
  }
}

describe('CommandAutoDiscovery', () => {
  let logger: Logger;
  let _loggerSpy: MockedFunction<typeof logger.info>;
  let discovery: CommandAutoDiscovery;

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG);
    _loggerSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    discovery = new CommandAutoDiscovery(logger);
  });

  describe('コマンド自動検出', () => {
    it('src/commandsディレクトリからコマンドファイルを検出できる', async () => {
      const commands = await discovery.discoverCommands();
      
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
    });

    it('検出されたコマンドが正しい構造を持つ', async () => {
      const commands = await discovery.discoverCommandsWithClass();
      
      commands.forEach(command => {
        expect(command).toHaveProperty('name');
        expect(command).toHaveProperty('description');
        expect(command).toHaveProperty('commandClass');
        expect(typeof command.name).toBe('string');
        expect(typeof command.description).toBe('string');
        expect(typeof command.commandClass).toBe('function');
      });
    });

    it('PingCommandが検出される', async () => {
      const commands = await discovery.discoverCommands();
      
      const pingCommand = commands.find(cmd => cmd.name === 'ping');
      expect(pingCommand).toBeDefined();
      expect(pingCommand?.description).toContain('疎通確認');
    });
  });

  describe('SlashCommand変換', () => {
    it('BaseCommandをSlashCommandBuilderに変換できる', () => {
      const mockCommand = new MockCommand('test', 'Test command', logger);
      
      const slashCommand = discovery.convertToSlashCommand(mockCommand);
      
      expect(slashCommand).toHaveProperty('name', 'test');
      expect(slashCommand).toHaveProperty('description', 'Test command');
    });

    it('複数のコマンドを一括変換できる', () => {
      const commands = [
        new MockCommand('test1', 'Test command 1', logger),
        new MockCommand('test2', 'Test command 2', logger)
      ];
      
      const slashCommands = discovery.convertToSlashCommands(commands);
      
      expect(slashCommands).toHaveLength(2);
      expect(slashCommands[0]).toHaveProperty('name', 'test1');
      expect(slashCommands[1]).toHaveProperty('name', 'test2');
    });
  });

  describe('エラーハンドリング', () => {
    it('無効なファイルがあってもエラーにならない', async () => {
      // モックで無効なファイルが含まれる状況をシミュレート
      vi.spyOn(discovery as any, 'loadCommandFromFile').mockImplementation((file: string) => {
        if (file.includes('invalid')) {
          throw new Error('Invalid command file');
        }
        return new MockCommand('test', 'Test command', logger);
      });

      const commands = await discovery.discoverCommands();
      
      expect(Array.isArray(commands)).toBe(true);
    });
  });

  describe('変更検知', () => {
    it('ファイルの変更時刻を取得できる', async () => {
      const filePath = 'src/commands/PingCommand.ts';
      const lastModified = await discovery.getFileLastModified(filePath);
      
      expect(typeof lastModified).toBe('number');
      expect(lastModified).toBeGreaterThan(0);
    });

    it('存在しないファイルの場合は0を返す', async () => {
      const filePath = 'src/commands/NonExistentCommand.ts';
      const lastModified = await discovery.getFileLastModified(filePath);
      
      expect(lastModified).toBe(0);
    });
  });
});