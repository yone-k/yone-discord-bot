import { describe, expect, it } from 'vitest';
import { buildNurseryMenuContainer, formatNurseryMenuDate, isBusinessDate, tokyoDate } from '../../src/ui/NurseryMenuFormatter';

describe('NurseryMenuFormatter', () => {
  it('computes today and tomorrow on the Tokyo calendar', () => {
    const beforeMidnight = new Date('2026-10-01T14:59:59.999Z');
    const midnight = new Date('2026-10-01T15:00:00.000Z');
    expect(tokyoDate(beforeMidnight)).toBe('2026-10-01');
    expect(tokyoDate(beforeMidnight, 1)).toBe('2026-10-02');
    expect(tokyoDate(midnight)).toBe('2026-10-02');
    expect(tokyoDate(new Date('2026-12-31T15:00:00.000Z'), 1)).toBe('2027-01-02');
  });

  it('accepts only existing YYYY-MM-DD dates', () => {
    expect(isBusinessDate('2026-10-02')).toBe(true);
    for (const value of ['2026-02-30', '2026-1-02', '2026/10/02', '']) {
      expect(isBusinessDate(value)).toBe(false);
    }
  });

  it('labels the date with a Japanese weekday', () => {
    expect(formatNurseryMenuDate('2026-10-02')).toBe('10/2(金)');
    expect(formatNurseryMenuDate('2026-10-04')).toBe('10/4(日)');
  });

  it('renders the same card as the morning post without a mention', () => {
    const card = buildNurseryMenuContainer({ date: '2026-10-02', lunch: 'ご飯\n鮭', snack: null }).toJSON() as { components: { content: string }[] };
    expect(card.components.map(component => component.content)).toEqual(['## 🍱 10/2(金) の献立', '**昼食**\nご飯\n鮭']);
  });
});
