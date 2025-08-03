import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsoleMigrationHelper } from '../../src/utils/ConsoleMigrationHelper';

describe('ConsoleMigrationHelper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock Date.now() for consistent testing
    vi.spyOn(Date, 'now').mockReturnValue(1234567890123);
  });

  it('should create metadata with component and method', () => {
    const meta = ConsoleMigrationHelper.createMetadata('TestComponent', 'testMethod');
    
    expect(meta).toHaveProperty('component', 'TestComponent');
    expect(meta).toHaveProperty('method', 'testMethod');
    expect(meta).toHaveProperty('timestamp', 1234567890123);
  });

  it('should create metadata with extra properties', () => {
    const extra = { userId: '123', action: 'create' };
    const meta = ConsoleMigrationHelper.createMetadata('TestComponent', 'testMethod', extra);
    
    expect(meta).toHaveProperty('component', 'TestComponent');
    expect(meta).toHaveProperty('method', 'testMethod');
    expect(meta).toHaveProperty('timestamp', 1234567890123);
    expect(meta).toHaveProperty('userId', '123');
    expect(meta).toHaveProperty('action', 'create');
  });

  it('should handle empty component name', () => {
    const meta = ConsoleMigrationHelper.createMetadata('', 'testMethod');
    
    expect(meta).toHaveProperty('component', '');
    expect(meta).toHaveProperty('method', 'testMethod');
    expect(meta).toHaveProperty('timestamp');
  });

  it('should handle empty method name', () => {
    const meta = ConsoleMigrationHelper.createMetadata('TestComponent', '');
    
    expect(meta).toHaveProperty('component', 'TestComponent');
    expect(meta).toHaveProperty('method', '');
    expect(meta).toHaveProperty('timestamp');
  });

  it('should overwrite base properties if provided in extra', () => {
    const extra = { component: 'OverriddenComponent', timestamp: 9999999999 };
    const meta = ConsoleMigrationHelper.createMetadata('TestComponent', 'testMethod', extra);
    
    // Extra properties should override base properties
    expect(meta).toHaveProperty('component', 'OverriddenComponent');
    expect(meta).toHaveProperty('method', 'testMethod');
    expect(meta).toHaveProperty('timestamp', 9999999999);
  });

  it('should handle null extra parameter', () => {
    const meta = ConsoleMigrationHelper.createMetadata('TestComponent', 'testMethod', null);
    
    expect(meta).toHaveProperty('component', 'TestComponent');
    expect(meta).toHaveProperty('method', 'testMethod');
    expect(meta).toHaveProperty('timestamp', 1234567890123);
  });

  it('should handle undefined extra parameter', () => {
    const meta = ConsoleMigrationHelper.createMetadata('TestComponent', 'testMethod', undefined);
    
    expect(meta).toHaveProperty('component', 'TestComponent');
    expect(meta).toHaveProperty('method', 'testMethod');
    expect(meta).toHaveProperty('timestamp', 1234567890123);
  });

  it('should handle complex extra objects', () => {
    const extra = {
      error: { message: 'Something went wrong', code: 500 },
      context: { requestId: 'req-123', userId: 'user-456' },
      data: [1, 2, 3]
    };
    const meta = ConsoleMigrationHelper.createMetadata('TestComponent', 'testMethod', extra);
    
    expect(meta).toHaveProperty('component', 'TestComponent');
    expect(meta).toHaveProperty('method', 'testMethod');
    expect(meta).toHaveProperty('timestamp', 1234567890123);
    expect(meta).toHaveProperty('error', { message: 'Something went wrong', code: 500 });
    expect(meta).toHaveProperty('context', { requestId: 'req-123', userId: 'user-456' });
    expect(meta).toHaveProperty('data', [1, 2, 3]);
  });
});