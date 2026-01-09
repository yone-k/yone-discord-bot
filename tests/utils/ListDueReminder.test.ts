import { describe, it, expect } from 'vitest';
import { createListItem } from '../../src/models/ListItem';
import { shouldSendListDueReminder } from '../../src/utils/ListDueReminder';

describe('ListDueReminder', () => {
  const baseItem = createListItem(
    '牛乳',
    '食品',
    new Date('2026-01-09T00:00:00+09:00'),
    false
  );

  it('sends reminder on due date when not notified', () => {
    const now = new Date('2026-01-09T00:10:00+09:00');
    expect(shouldSendListDueReminder(baseItem, now)).toBe(true);
  });

  it('does not send reminder before due date', () => {
    const now = new Date('2026-01-08T23:59:00+09:00');
    expect(shouldSendListDueReminder(baseItem, now)).toBe(false);
  });

  it('does not send reminder when already notified same day', () => {
    const now = new Date('2026-01-09T12:00:00+09:00');
    const item = { ...baseItem, lastNotifiedAt: new Date('2026-01-09T01:00:00+09:00') };
    expect(shouldSendListDueReminder(item, now)).toBe(false);
  });

  it('does not send reminder for checked item', () => {
    const now = new Date('2026-01-09T00:10:00+09:00');
    const item = { ...baseItem, check: true };
    expect(shouldSendListDueReminder(item, now)).toBe(false);
  });

  it('does not send reminder when until is null', () => {
    const now = new Date('2026-01-09T00:10:00+09:00');
    const item = { ...baseItem, until: null };
    expect(shouldSendListDueReminder(item, now)).toBe(false);
  });
});
