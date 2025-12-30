import { RemindTask } from '../models/RemindTask';

const TOKYO_OFFSET_MINUTES = 9 * 60;

export function shouldSendPreReminder(task: RemindTask, now: Date): boolean {
  if (task.isPaused) {
    return false;
  }

  const windowStart = new Date(task.nextDueAt.getTime() - task.remindBeforeMinutes * 60 * 1000);
  const isInWindow = now.getTime() >= windowStart.getTime() && now.getTime() <= task.nextDueAt.getTime();
  if (!isInWindow) {
    return false;
  }

  if (task.lastRemindDueAt && task.lastRemindDueAt.getTime() === task.nextDueAt.getTime()) {
    return false;
  }

  return true;
}

export function shouldSendOverdue(task: RemindTask, now: Date): boolean {
  if (task.isPaused) {
    return false;
  }

  if (now.getTime() <= task.nextDueAt.getTime()) {
    return false;
  }

  if (task.overdueNotifyCount >= 5) {
    return false;
  }

  if (task.lastOverdueNotifiedAt && isSameTokyoDate(task.lastOverdueNotifiedAt, now)) {
    return false;
  }

  return true;
}

function isSameTokyoDate(a: Date, b: Date): boolean {
  const aTokyo = new Date(a.getTime() + TOKYO_OFFSET_MINUTES * 60 * 1000);
  const bTokyo = new Date(b.getTime() + TOKYO_OFFSET_MINUTES * 60 * 1000);

  return (
    aTokyo.getUTCFullYear() === bTokyo.getUTCFullYear()
    && aTokyo.getUTCMonth() === bTokyo.getUTCMonth()
    && aTokyo.getUTCDate() === bTokyo.getUTCDate()
  );
}
