import { describe, it, expect } from 'vitest';
import { RemindTaskFormatter } from '../../src/ui/RemindTaskFormatter';
import { createRemindTask } from '../../src/models/RemindTask';

describe('RemindTaskFormatter', () => {
  it('marks upcoming task with hourglass', () => {
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
    expect(embed.data.description).toContain('⌛');
  });

  it('marks overdue task with warning', () => {
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

    const embed = RemindTaskFormatter.formatTaskEmbed(task, new Date('2026-01-06T10:00:00+09:00'));
    expect(embed.data.description).toContain('❗');
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

    const embed = RemindTaskFormatter.formatTaskEmbed(task, new Date('2026-01-04T09:00:00+09:00'));
    expect(embed.data.description).toContain('2026/1/5 09:00');
  });

  it('renders remind-before in day-hour-minute format', () => {
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

    const embed = RemindTaskFormatter.formatTaskEmbed(task, new Date('2026-01-04T09:00:00+09:00'));
    expect(embed.data.description).toContain('事前通知: 01時間30分前');
  });
});
