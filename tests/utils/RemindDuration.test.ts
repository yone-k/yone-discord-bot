import { describe, it, expect } from 'vitest';
import { formatRemindBeforeDisplay, formatRemindBeforeInput, formatRemainingDuration, parseRemindBeforeInput } from '../../src/utils/RemindDuration';

describe('RemindDuration', () => {
  it('formats display as DD日HH時間MM分前', () => {
    expect(formatRemindBeforeDisplay(90)).toBe('01時間30分前');
  });

  it('hides day and hour when both are zero', () => {
    expect(formatRemindBeforeDisplay(30)).toBe('30分前');
  });

  it('formats input as H:I when under a day', () => {
    expect(formatRemindBeforeInput(90)).toBe('01:30');
  });

  it('formats input as D:H:I when over a day', () => {
    expect(formatRemindBeforeInput(1500)).toBe('1:01:00');
  });

  it('parses H:I format', () => {
    expect(parseRemindBeforeInput('2:30')).toBe(150);
  });

  it('parses D:H:I format', () => {
    expect(parseRemindBeforeInput('1:02:03')).toBe(1563);
  });

  it('formats remaining duration with omitted zero parts', () => {
    expect(formatRemainingDuration(30)).toBe('30分');
    expect(formatRemainingDuration(60)).toBe('1時間');
    expect(formatRemainingDuration(90)).toBe('1時間30分');
    expect(formatRemainingDuration(1440)).toBe('1日');
    expect(formatRemainingDuration(1500)).toBe('1日1時間');
    expect(formatRemainingDuration(1501)).toBe('1日1時間1分');
  });

  it('rejects invalid format', () => {
    expect(() => parseRemindBeforeInput('1')).toThrow('事前通知はD:H:IまたはH:I形式で指定してください');
  });

  it('rejects minutes overflow', () => {
    expect(() => parseRemindBeforeInput('1:60')).toThrow('事前通知はD:H:IまたはH:I形式で指定してください');
  });

  it('rejects out of range', () => {
    expect(() => parseRemindBeforeInput('7:00:01')).toThrow('事前通知は0日00時間00分〜7日00時間00分の範囲で指定してください');
  });
});
