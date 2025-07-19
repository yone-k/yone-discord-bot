import { CommandAutoDiscovery } from './CommandAutoDiscovery';
import { Logger, LogLevel } from '../src/utils/logger';

async function testDiscovery(): Promise<void> {
  console.log('=== Command Auto Discovery Test ===\n');
  
  const logger = new Logger(LogLevel.INFO);
  const discovery = new CommandAutoDiscovery(logger);

  try {
    // コマンドの自動検出
    console.log('1. Discovering commands...');
    const commands = await discovery.discoverCommands();
    
    console.log(`✅ Discovered ${commands.length} commands:\n`);
    
    commands.forEach((command, index) => {
      console.log(`  ${index + 1}. ${command.getName()}: ${command.getDescription()}`);
    });
    
    // SlashCommand変換
    console.log('\n2. Converting to Slash Commands...');
    const slashCommands = discovery.convertToSlashCommands(commands);
    
    console.log(`✅ Converted ${slashCommands.length} commands:\n`);
    
    slashCommands.forEach((cmd: { name: string; description: string }, index) => {
      console.log(`  ${index + 1}. /${cmd.name} - ${cmd.description}`);
    });
    
    // 変更検知テスト
    console.log('\n3. Testing change detection...');
    const lastWeek = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const hasChanges = await discovery.hasCommandsChanged(lastWeek);
    
    console.log(`✅ Commands changed since last week: ${hasChanges ? 'Yes' : 'No'}`);
    
    // ファイル変更時刻確認
    console.log('\n4. Checking file modification times...');
    const pingFile = 'src/commands/PingCommand.ts';
    const lastModified = await discovery.getFileLastModified(pingFile);
    
    if (lastModified > 0) {
      const modDate = new Date(lastModified);
      console.log(`✅ ${pingFile} last modified: ${modDate.toISOString()}`);
    } else {
      console.log(`❌ ${pingFile} not found`);
    }
    
    console.log('\n=== Auto Discovery Test Completed Successfully ===');
    
  } catch (error) {
    console.error('\n❌ Auto Discovery Test Failed:', error);
    process.exit(1);
  }
}

testDiscovery().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});