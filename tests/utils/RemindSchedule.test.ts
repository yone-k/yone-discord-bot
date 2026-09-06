import { describe, expect, it } from 'vitest';
import { normalizeTimeOfDay } from '../../src/utils/RemindSchedule';

describe('時刻入力の表記', () => {
  it.each([['9:5', '09:05'], ['0:0', '00:00'], ['23:59', '23:59']])('%sを%sへ揃える', (input, expected) => {
    expect(normalizeTimeOfDay(input)).toBe(expected);
  });
  it.each(['24:00', '12:60', '-1:00', '09:00:00', '9', ''])('HH:mmへ変換できない入力%sを拒否する', input => {
    expect(() => normalizeTimeOfDay(input)).toThrow('Invalid timeOfDay');
  });
});
