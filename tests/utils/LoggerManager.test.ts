import { describe, it, expect, beforeEach } from 'vitest';
import { LoggerManager } from '../../src/utils/LoggerManager';

describe('LoggerManager', () => {
  beforeEach(() => {
    // Clean up singletons between tests
    (LoggerManager as any).instances = new Map();
  });

  it('should create singleton logger instances', () => {
    const logger1 = LoggerManager.getLogger('TestComponent');
    const logger2 = LoggerManager.getLogger('TestComponent');
    expect(logger1).toBe(logger2);
  });

  it('should create different logger instances for different components', () => {
    const logger1 = LoggerManager.getLogger('ComponentA');
    const logger2 = LoggerManager.getLogger('ComponentB');
    expect(logger1).not.toBe(logger2);
  });

  it('should return Logger instance', () => {
    const logger = LoggerManager.getLogger('TestComponent');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('should reuse existing logger for same component name', () => {
    const logger1 = LoggerManager.getLogger('SameComponent');
    const logger2 = LoggerManager.getLogger('SameComponent');
    const logger3 = LoggerManager.getLogger('SameComponent');
    
    expect(logger1).toBe(logger2);
    expect(logger2).toBe(logger3);
  });

  it('should handle empty component name', () => {
    const logger = LoggerManager.getLogger('');
    expect(logger).toBeDefined();
  });

  it('should handle special characters in component name', () => {
    const logger = LoggerManager.getLogger('Component-With-Special.Characters_123');
    expect(logger).toBeDefined();
  });
});