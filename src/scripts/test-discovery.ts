import { CommandAutoDiscovery } from './CommandAutoDiscovery';
import { Logger, LogLevel } from '../utils/logger';

async function testDiscovery(): Promise<void> {
  const logger = new Logger(LogLevel.INFO);
  logger.info('=== Command Auto Discovery Test ===\n');
  
  const discovery = new CommandAutoDiscovery(logger);

  try {
    // コマンドの自動検出
    logger.info('1. Discovering commands...');
    const commands = await discovery.discoverCommands();
    
    logger.info(`✅ Discovered ${commands.length} commands:\n`);
    
    commands.forEach((command, index) => {
      logger.info(`  ${index + 1}. ${command.name}: ${command.description}`);
    });
    
    // SlashCommand変換
    logger.info('\n2. Converting to Slash Commands...');
    const slashCommands = discovery.convertToSlashCommands(commands);
    
    logger.info(`✅ Converted ${slashCommands.length} commands:\n`);
    
    slashCommands.forEach((cmd: { name: string; description: string }, index) => {
      logger.info(`  ${index + 1}. /${cmd.name} - ${cmd.description}`);
    });
    
    // 変更検知テスト
    logger.info('\n3. Testing change detection...');
    const lastWeek = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const hasChanges = await discovery.hasCommandsChanged(lastWeek);
    
    logger.info(`✅ Commands changed since last week: ${hasChanges ? 'Yes' : 'No'}`);
    
    // ファイル変更時刻確認
    logger.info('\n4. Checking file modification times...');
    const pingFile = 'src/commands/PingCommand.ts';
    const lastModified = await discovery.getFileLastModified(pingFile);
    
    if (lastModified > 0) {
      const modDate = new Date(lastModified);
      logger.info(`✅ ${pingFile} last modified: ${modDate.toISOString()}`);
    } else {
      logger.info(`❌ ${pingFile} not found`);
    }
    
    logger.info('\n=== Auto Discovery Test Completed Successfully ===');
    
  } catch (error) {
    logger.error('\n❌ Auto Discovery Test Failed:', { error: String(error) });
    process.exit(1);
  }
}

testDiscovery().catch((error) => {
  const logger = new Logger(LogLevel.ERROR);
  logger.error('Fatal error:', { error: String(error) });
  process.exit(1);
});