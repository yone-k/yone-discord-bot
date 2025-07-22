import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import { Logger, LogLevel } from '../../src/utils/logger';

describe('Logger', () => {
  let consoleSpy: MockedFunction<typeof console.log>;
  
  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('ログレベル', () => {
    it('DEBUG レベルでログ出力できる', () => {
      const logger = new Logger(LogLevel.DEBUG);
      logger.debug('Debug message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[DEBUG\] Debug message$/)
      );
    });

    it('INFO レベルでログ出力できる', () => {
      const logger = new Logger(LogLevel.INFO);
      logger.info('Info message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[INFO\] Info message$/)
      );
    });

    it('WARN レベルでログ出力できる', () => {
      const logger = new Logger(LogLevel.WARN);
      logger.warn('Warning message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[WARN\] Warning message$/)
      );
    });

    it('ERROR レベルでログ出力できる', () => {
      const logger = new Logger(LogLevel.ERROR);
      logger.error('Error message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[ERROR\] Error message$/)
      );
    });
  });

  describe('ログレベルフィルタリング', () => {
    it('INFO レベルの場合、DEBUG ログは出力されない', () => {
      const logger = new Logger(LogLevel.INFO);
      logger.debug('Debug message');
      
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('WARN レベルの場合、DEBUG・INFO ログは出力されない', () => {
      const logger = new Logger(LogLevel.WARN);
      logger.debug('Debug message');
      logger.info('Info message');
      
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('ERROR レベルの場合、ERROR のみ出力される', () => {
      const logger = new Logger(LogLevel.ERROR);
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');
      
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[ERROR\] Error message$/)
      );
    });
  });

  describe('タイムスタンプフォーマット', () => {
    it('YYYY-MM-DD HH:mm:ss 形式でタイムスタンプが出力される', () => {
      const logger = new Logger(LogLevel.DEBUG);
      logger.info('Test message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/)
      );
    });
  });

  describe('構造化ログ', () => {
    it('メタデータオブジェクトがある場合はJSON形式で出力される', () => {
      const logger = new Logger(LogLevel.DEBUG);
      const meta = { userId: 'test-user', action: 'test' };
      logger.info('Test message', meta);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[INFO\] Test message$/),
        JSON.stringify(meta)
      );
    });

    it('空のメタデータオブジェクトの場合は通常のログ形式で出力される', () => {
      const logger = new Logger(LogLevel.DEBUG);
      logger.info('Test message', {});
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[INFO\] Test message$/)
      );
    });

    it('メタデータがない場合は通常のログ形式で出力される', () => {
      const logger = new Logger(LogLevel.DEBUG);
      logger.info('Test message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[INFO\] Test message$/)
      );
    });

    it('すべてのログレベルで構造化ログが使用できる', () => {
      const logger = new Logger(LogLevel.DEBUG);
      const meta = { context: 'test' };
      
      logger.debug('Debug message', meta);
      logger.info('Info message', meta);
      logger.warn('Warn message', meta);
      logger.error('Error message', meta);
      
      expect(consoleSpy).toHaveBeenCalledTimes(4);
      expect(consoleSpy).toHaveBeenNthCalledWith(1,
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[DEBUG\] Debug message$/),
        JSON.stringify(meta)
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(2,
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[INFO\] Info message$/),
        JSON.stringify(meta)
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(3,
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[WARN\] Warn message$/),
        JSON.stringify(meta)
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(4,
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[ERROR\] Error message$/),
        JSON.stringify(meta)
      );
    });
  });
});