import { describe, it, expect } from 'vitest';
import { createChannelMetadata, validateChannelMetadata, generateListTitle } from '../../src/models/ChannelMetadata';

describe('ChannelMetadata', () => {
  it('creates independent channel settings without Sheets sync state', () => {
    const metadata = createChannelMetadata('123', '456', ' 買い物 ', '789', '食品');
    expect(metadata).toEqual({ channelId: '123', messageId: '456', listTitle: '買い物', operationLogThreadId: '789', defaultCategory: '食品' });
  });
  it('uses the default category and permits an uncreated Discord message', () => {
    const metadata = createChannelMetadata('123', '', '買い物');
    expect(metadata.defaultCategory).toBe('その他');
    expect(() => validateChannelMetadata(metadata)).not.toThrow();
  });
  it('rejects missing channels', () => {
    expect(() => validateChannelMetadata(createChannelMetadata('', '', '買い物'))).toThrow('チャンネルIDは必須です');
  });
  it('rejects blank titles', () => {
    expect(() => validateChannelMetadata(createChannelMetadata('123', '', ' '))).toThrow('リストタイトルは必須です');
  });
  it.each([['買い物', '買い物リスト'], [' test ', 'testリスト'], ['', '123'], [null, '123']])('generates a title for %s', (name, expected) => {
    expect(generateListTitle(name, '123')).toBe(expected);
  });
});
