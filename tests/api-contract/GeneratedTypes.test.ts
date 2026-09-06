import { expect, it } from 'vitest';
import type { components } from '../../src/api/generated/schema';

it('preserves all channel and entity fields in generated TypeScript types', () => {
  const channel = {
    channelId: 'legacy', messageId: null, listTitle: 'List', operationLogThreadId: null,
    defaultCategory: 'other', editVersion: '9007199254740993'
  } satisfies components['schemas']['ListChannel'];
  const inventory = {
    channelId: 'channel', id: 'legacy', name: 'item', stock: '0.1234567890123456789',
    category: null, position: 0
  } satisfies components['schemas']['StoredInventoryItem'];
  expect(JSON.parse(JSON.stringify(channel)).editVersion).toBe('9007199254740993');
  expect(JSON.parse(JSON.stringify(inventory)).stock).toBe('0.1234567890123456789');
});
