import { describe, it, expect } from 'vitest';
import { calculateStartAt, calculateNextDueAt } from '../../src/utils/RemindSchedule';

describe('RemindSchedule', () => {
  it('calculates startAt using Tokyo date with timeOfDay', () => {
    const createdAt = new Date('2025-12-29T00:30:00Z');
    const startAt = calculateStartAt(createdAt, '08:30');

    expect(startAt.toISOString()).toBe('2025-12-28T23:30:00.000Z');
  });

  it('calculates nextDueAt from startAt when lastDoneAt is empty', () => {
    const startAt = new Date('2025-12-29T08:30:00+09:00');
    const now = new Date('2025-12-29T09:00:00+09:00');

    const nextDueAt = calculateNextDueAt(
      {
        intervalDays: 2,
        timeOfDay: '08:30',
        startAt,
        lastDoneAt: null
      },
      now
    );

    expect(nextDueAt.toISOString()).toBe('2025-12-30T23:30:00.000Z');
  });

  it('rolls forward nextDueAt until it is in the future', () => {
    const startAt = new Date('2025-12-29T08:30:00+09:00');
    const now = new Date('2025-12-31T10:00:00+09:00');

    const nextDueAt = calculateNextDueAt(
      {
        intervalDays: 1,
        timeOfDay: '08:30',
        startAt,
        lastDoneAt: null
      },
      now
    );

    expect(nextDueAt.toISOString()).toBe('2025-12-31T23:30:00.000Z');
  });
});
