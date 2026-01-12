import { describe, it, expect } from 'vitest';
import { RemindTaskFormatter } from '../../src/ui/RemindTaskFormatter';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskFormatter', () => {
  it('renders detail text with deadline, interval, and remind-before', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: 'フィルター交換',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const detail = RemindTaskFormatter.formatDetailText(task, new Date('2026-01-05T08:30:00+09:00'));
    expect(detail).toContain('期限: 2026/1/5 09:00');
    expect(detail).toContain('周期: 7日');
    expect(detail).toContain('事前通知: 1時間前');
  });

  it('renders next due date in description', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: 'フィルター交換',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const embed = RemindTaskFormatter.formatTaskEmbed(task, new Date('2025-12-01T09:00:00+09:00'));
    expect(embed.data.description).toContain('期限: 2026/1/5 09:00');
  });

  it('renders remind-before in detail text', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: 'フィルター交換',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 90,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const detail = RemindTaskFormatter.formatDetailText(task, new Date('2026-01-04T09:00:00+09:00'));
    expect(detail).toContain('事前通知: 1時間30分前');
  });

  it('shows remaining days when under 1 month', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: 'フィルター交換',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-10T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const embed = RemindTaskFormatter.formatTaskEmbed(task, new Date('2026-01-04T09:00:00+09:00'));
    expect(embed.data.description).toContain('残り: 6日');
    expect(embed.data.description).not.toContain('期限:');
  });

  it('shows overdue text in bold when past due', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: 'フィルター交換',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const embed = RemindTaskFormatter.formatTaskEmbed(task, new Date('2026-01-06T09:00:00+09:00'));
    expect(embed.data.description).toContain('**期限切れ**');
    expect(embed.data.description).not.toContain('-#');
    expect(embed.data.description).not.toContain('残り:');
  });

  it('shows remaining time in hours and minutes when under 1 day', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: 'フィルター交換',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const embed = RemindTaskFormatter.formatTaskEmbed(task, new Date('2026-01-04T10:30:00+09:00'));
    expect(embed.data.description).toContain('残り: 22時間30分');
    expect(embed.data.description).not.toContain('期限:');
  });

  it('shows remaining minutes only when under 1 hour', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: 'フィルター交換',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const embed = RemindTaskFormatter.formatTaskEmbed(task, new Date('2026-01-05T08:30:00+09:00'));
    expect(embed.data.description).toContain('残り: 30分');
    expect(embed.data.description).not.toContain('0時間');
  });

  it('includes inventory summary in formatSummaryText', () => {
    const task = createRemindTask({
      id: 'task-1',
      title: '補充チェック',
      intervalDays: 7,
      timeOfDay: '09:00',
      remindBeforeMinutes: 60,
      inventoryItems: [
        { name: '牛乳', stock: 3, consume: 1 },
        { name: '卵', stock: 2, consume: 1 }
      ],
      startAt: new Date('2025-12-29T09:00:00+09:00'),
      nextDueAt: new Date('2026-01-05T09:00:00+09:00'),
      createdAt: new Date('2025-12-29T09:00:00+09:00'),
      updatedAt: new Date('2025-12-29T09:00:00+09:00')
    });

    const summary = RemindTaskFormatter.formatSummaryText(task, new Date('2026-01-04T09:00:00+09:00'));
    expect(summary.detailsText).toContain('在庫: 牛乳 3, 卵 2');
  });
});
